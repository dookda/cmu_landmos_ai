"""
CMU LandMOS AI - Local AI Chart Reader for GNSS Point Displacement
FastAPI Backend with Ollama Integration (LLaVA vision model)
"""

import os
import json
import uuid
import base64
import logging
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── Configuration ─────────────────────────────────────────────────────
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
VISION_MODEL = os.getenv("VISION_MODEL", "moondream")
TEXT_MODEL = os.getenv("TEXT_MODEL", "llama3.2:1b")
LANDMOS_API_BASE = os.getenv("LANDMOS_API_BASE", "https://hpc.landmos.com/apiv3")
UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Model Modes ────────────────────────────────────────────────────────
MODEL_MODES = {
    "moondream": {
        "name": "Moondream",
        "description": "Moondream 1.8B — Lightweight vision model, low RAM (~2 GB)",
        "description_th": "Moondream 1.8B — โมเดลวิทัศน์ขนาดเล็ก ใช้ RAM น้อย (~2 GB)",
        "vision_model": "moondream",
        "text_model": "llama3.2:1b",
        "icon": "🌙",
        "min_ram_gb": 3,
    },
    "llava": {
        "name": "LLaVA",
        "description": "LLaVA 7B — Better accuracy, requires more RAM (~8 GB)",
        "description_th": "LLaVA 7B — แม่นยำกว่า ต้องใช้ RAM มากกว่า (~8 GB)",
        "vision_model": "llava:7b",
        "text_model": "llama3.2:3b",
        "icon": "🦙",
        "min_ram_gb": 8,
    },
}

DEFAULT_MODEL_MODE = "moondream"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── FastAPI App ───────────────────────────────────────────────────────
app = FastAPI(
    title="CMU LandMOS AI - GNSS Chart Reader",
    description="Local AI service for reading and describing GNSS point displacement charts",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────


class AnalysisResponse(BaseModel):
    id: str
    filename: str
    description: str
    summary: str
    details: dict
    timestamp: str
    chart_url: str


class StationAnalysisResponse(BaseModel):
    id: str
    stat_code: str
    description: str
    summary: str
    details: dict
    station_data: dict
    timestamp: str


class ModelStatus(BaseModel):
    ollama_status: str
    vision_model: str
    text_model: str
    vision_model_ready: bool
    text_model_ready: bool
    available_modes: dict = {}


# ── Helper Functions ──────────────────────────────────────────────────


def image_to_base64(image_path: str) -> str:
    """Convert an image file to base64 string."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


async def check_ollama_model(model_name: str) -> bool:
    """Check if a model is available in Ollama."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [m["name"] for m in data.get("models", [])]
                return model_name in models or any(
                    model_name.split(":")[0] in m for m in models
                )
    except Exception as e:
        logger.error(f"Error checking model {model_name}: {e}")
    return False


async def ensure_model_pulled(model_name: str) -> bool:
    """Check if a model exists, and pull it if not. Returns True if ready."""
    if await check_ollama_model(model_name):
        return True
    logger.info(f"Model {model_name} not found, attempting to pull...")
    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/pull",
                json={"name": model_name},
            )
            if resp.status_code == 200:
                logger.info(f"Model {model_name} pulled successfully")
                return True
            else:
                logger.error(f"Failed to pull {model_name}: {resp.status_code}")
    except Exception as e:
        logger.error(f"Error pulling model {model_name}: {e}")
    return False


def _parse_ollama_error(resp) -> str:
    """Extract a useful error message from an Ollama error response."""
    try:
        data = resp.json()
        if "error" in data:
            return data["error"]
    except Exception:
        pass
    text = resp.text.strip()
    return text[:300] if text else f"status {resp.status_code}"


async def query_ollama_vision(image_base64: str, prompt: str, model: str = None) -> str:
    """Query Ollama with a vision model for chart analysis."""
    vision_model = model or VISION_MODEL
    payload = {
        "model": vision_model,
        "prompt": prompt,
        "images": [image_base64],
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 2048},
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate", json=payload
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("response", "No response generated.")
            else:
                detail = _parse_ollama_error(resp)
                logger.error(f"Ollama vision error: {resp.status_code} - {detail}")
                return f"Error: {detail}"
    except httpx.TimeoutException:
        return "Error: Request to Ollama timed out. The model may still be loading."
    except httpx.ConnectError:
        return "Error: Cannot connect to Ollama. Is the Ollama service running?"
    except Exception as e:
        logger.error(f"Error querying Ollama vision: {e}")
        return f"Error: {str(e)}"


async def query_ollama_text(prompt: str, model: str = None, num_ctx: int = 2048) -> str:
    """Query Ollama with a text model for generating summaries."""
    text_model = model or TEXT_MODEL
    payload = {
        "model": text_model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 1024, "num_ctx": num_ctx},
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate", json=payload
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("response", "No response generated.")
            else:
                detail = _parse_ollama_error(resp)
                logger.error(f"Ollama text error: {resp.status_code} - {detail}")
                return f"Error: {detail}"
    except httpx.TimeoutException:
        return "Error: Request to Ollama timed out. The model may still be loading."
    except httpx.ConnectError:
        return "Error: Cannot connect to Ollama. Is the Ollama service running?"
    except Exception as e:
        logger.error(f"Error querying Ollama text: {e}")
        return f"Error: {str(e)}"


# ── API Endpoints ─────────────────────────────────────────────────────


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/api/models/status", response_model=ModelStatus)
async def get_model_status():
    """Check Ollama and model availability."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            ollama_ok = resp.status_code == 200
    except Exception:
        ollama_ok = False

    vision_ready = await check_ollama_model(VISION_MODEL) if ollama_ok else False
    text_ready = await check_ollama_model(TEXT_MODEL) if ollama_ok else False

    # Check readiness of all model modes
    available_modes = {}
    for mode_key, mode_config in MODEL_MODES.items():
        if ollama_ok:
            v_ready = await check_ollama_model(mode_config["vision_model"])
            t_ready = await check_ollama_model(mode_config["text_model"])
        else:
            v_ready = False
            t_ready = False
        available_modes[mode_key] = {
            "name": mode_config["name"],
            "description": mode_config["description"],
            "description_th": mode_config["description_th"],
            "icon": mode_config["icon"],
            "vision_model": mode_config["vision_model"],
            "text_model": mode_config["text_model"],
            "vision_ready": v_ready,
            "text_ready": t_ready,
            "ready": v_ready and t_ready,
        }

    return ModelStatus(
        ollama_status="connected" if ollama_ok else "disconnected",
        vision_model=VISION_MODEL,
        text_model=TEXT_MODEL,
        vision_model_ready=vision_ready,
        text_model_ready=text_ready,
        available_modes=available_modes,
    )


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze_chart(
    file: UploadFile = File(...),
    language: str = Form(default="en"),
    model_mode: str = Form(default="llava"),
):
    """Upload and analyze a GNSS displacement chart using AI vision."""
    # Resolve model mode
    mode = MODEL_MODES.get(model_mode, MODEL_MODES[DEFAULT_MODEL_MODE])
    active_vision_model = mode["vision_model"]
    active_text_model = mode["text_model"]
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")

    # Ensure models are available (auto-pull if missing)
    if not await ensure_model_pulled(active_vision_model):
        raise HTTPException(
            503,
            detail=f"Vision model '{active_vision_model}' is not available and could not be pulled. "
                   "Please check that Ollama is running and has enough resources.",
        )
    if not await ensure_model_pulled(active_text_model):
        logger.warning(f"Text model '{active_text_model}' not available, will attempt anyway")

    # Save uploaded file
    chart_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename or "chart.png").suffix or ".png"
    filename = f"chart_{chart_id}{ext}"
    filepath = UPLOAD_DIR / filename

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Convert to base64 for Ollama
    img_base64 = base64.b64encode(content).decode("utf-8")

    # Determine response language instruction
    if language == "th":
        lang_instruction = """IMPORTANT: You MUST respond entirely in Thai language (ภาษาไทย). 
Use Thai for all explanations, descriptions, and interpretations. 
Technical terms like GNSS, ITRF, mm/year can remain in English, but all sentences and descriptions must be in Thai."""
    else:
        lang_instruction = "Please respond in English."

    # ── Step 1: Detailed chart description via LLaVA ──────────────
    vision_prompt = f"""You are an expert geodetic engineer and GNSS data analyst. 
Analyze this chart image in detail. It likely shows GNSS (Global Navigation Satellite System) 
point displacement data.

{lang_instruction}

Please provide a comprehensive analysis covering:

1. **Chart Type & Components**: What type of chart is this? What are the axes, labels, and components shown?

2. **Displacement Analysis**: 
   - Describe the displacement patterns for each component (East, North, Up/Vertical) if visible.
   - Identify any linear trends (magnitude and direction).
   - Note seasonal/periodic variations if present.
   - Highlight any anomalous points or sudden jumps.

3. **Station Information**: What station name, reference frame, or time period is shown?

4. **Interpretation**: 
   - What does this displacement pattern suggest about ground movement?
   - Is there evidence of land subsidence, tectonic motion, or structural deformation?
   - What is the approximate rate of displacement per year?

5. **Data Quality**: Comment on the scatter/noise level and overall data quality.

Please be specific with numbers and measurements where visible."""

    description = await query_ollama_vision(img_base64, vision_prompt, model=active_vision_model)

    if description.startswith("Error:"):
        raise HTTPException(503, detail=description)

    # ── Step 2: Generate user-friendly summary ────────────────────
    if language == "th":
        summary_lang_instruction = """IMPORTANT: You MUST write the summary entirely in Thai language (ภาษาไทย).
Use simple Thai that non-technical users can understand easily.
Technical terms like GNSS, mm/year can stay in English, but the sentences must be in Thai."""
    else:
        summary_lang_instruction = "Please write the summary in English."

    summary_prompt = f"""Based on the following technical analysis of a GNSS displacement chart, 
create a concise, easy-to-understand summary for a non-technical user. 
Explain what the chart shows and what it means in simple terms.

{summary_lang_instruction}

Technical Analysis:
{description}

Please write a 3-5 sentence summary that:
- Explains what the chart is measuring (ground/point movement)
- Highlights the key findings (direction and amount of movement)
- Explains any potential implications (e.g., subsidence risk, structural monitoring)
Keep it simple and informative."""

    summary = await query_ollama_text(summary_prompt, model=active_text_model)

    if summary.startswith("Error:"):
        # Vision worked but text summary failed — use a fallback
        summary = description[:300] + "..." if len(description) > 300 else description

    # Store analysis result
    result = {
        "id": chart_id,
        "filename": filename,
        "description": description,
        "summary": summary,
        "details": {
            "vision_model": active_vision_model,
            "text_model": active_text_model,
            "model_mode": model_mode,
            "original_filename": file.filename,
            "file_size_kb": round(len(content) / 1024, 1),
            "language": language,
        },
        "timestamp": datetime.now().isoformat(),
        "chart_url": f"/api/charts/{filename}",
    }

    return AnalysisResponse(**result)


@app.get("/api/charts/{filename}")
async def get_chart(filename: str):
    """Serve uploaded/generated chart images."""
    filepath = UPLOAD_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Chart not found")
    return FileResponse(filepath, media_type="image/png")


# LandMOS field descriptions
LANDMOS_FIELD_LABELS = {
    "de": "East displacement (m)",
    "dn": "North displacement (m)",
    "dh": "Height displacement (m)",
    "sde": "East displacement S.D. (m)",
    "sdn": "North displacement S.D. (m)",
    "sdh": "Height displacement S.D. (m)",
    "pdop": "PDOP",
    "no_satellite": "Satellite count",
    "lat": "Latitude",
    "lng": "Longitude",
}

# Key displacement fields to focus on
DISPLACEMENT_KEYS = ["de", "dn", "dh"]
QUALITY_KEYS = ["sde", "sdn", "sdh", "pdop", "no_satellite"]


def _summarize_station_data(station_data, stat_code: str) -> str:
    """Convert raw station JSON data into a compact text summary for the AI model."""
    records = station_data if isinstance(station_data, list) else (
        station_data.get("records") or station_data.get("data") or []
    )

    if not records:
        return f"Station: {stat_code}\nNo data records found."

    total = len(records)
    lines = [f"Station: {stat_code}", f"Total data points: {total}"]

    # Time range
    first_ts = records[0].get("timestamp", "?")
    last_ts = records[-1].get("timestamp", "?")
    lines.append(f"Time range: {first_ts} to {last_ts}")

    # Location from first record
    lat = records[0].get("lat")
    lng = records[0].get("lng")
    if lat and lng:
        lines.append(f"Location: lat={lat}, lng={lng}")

    # Statistics for displacement fields (most important)
    def _stats(key, label):
        vals = []
        for r in records:
            try:
                vals.append(float(r[key]))
            except (ValueError, TypeError, KeyError):
                pass
        if not vals:
            return None
        mn, mx = min(vals), max(vals)
        avg = sum(vals) / len(vals)
        # Compute first-to-last change for trend
        trend = vals[-1] - vals[0]
        return f"{label}: min={mn:.4f}, max={mx:.4f}, mean={avg:.4f}, total_change={trend:+.4f}"

    lines.append("\n--- Displacement Statistics ---")
    for k in DISPLACEMENT_KEYS:
        label = LANDMOS_FIELD_LABELS.get(k, k)
        stat = _stats(k, label)
        if stat:
            lines.append(stat)

    lines.append("\n--- Data Quality ---")
    for k in QUALITY_KEYS:
        label = LANDMOS_FIELD_LABELS.get(k, k)
        stat = _stats(k, label)
        if stat:
            lines.append(stat)

    # Sample rows: first 3 and last 3 (displacement + timestamp only)
    sample_keys = ["timestamp"] + DISPLACEMENT_KEYS
    lines.append(f"\nFirst 3 records (timestamp, de, dn, dh):")
    for r in records[:3]:
        row = ", ".join(f"{k}={r.get(k, '')}" for k in sample_keys if k in r)
        lines.append(f"  {row}")

    if total > 6:
        lines.append(f"Last 3 records:")
        for r in records[-3:]:
            row = ", ".join(f"{k}={r.get(k, '')}" for k in sample_keys if k in r)
            lines.append(f"  {row}")

    return "\n".join(lines)


# ── LandMOS API Integration ──────────────────────────────────────────


@app.get("/api/station/data")
async def get_station_data(
    stat_code: str,
    start_date: str = "",
    end_date: str = "",
):
    """Fetch GNSS station time-series data from the LandMOS API."""
    params = {"stat_code": stat_code}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{LANDMOS_API_BASE}/stations/data_by_stat_code",
                params=params,
            )
            if resp.status_code == 200:
                return resp.json()
            else:
                detail = resp.text[:300] if resp.text else f"status {resp.status_code}"
                raise HTTPException(resp.status_code, detail=f"LandMOS API error: {detail}")
    except httpx.ConnectError:
        raise HTTPException(502, detail="Cannot connect to LandMOS API server.")
    except httpx.TimeoutException:
        raise HTTPException(504, detail="LandMOS API request timed out.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching station data: {e}")
        raise HTTPException(500, detail=f"Error fetching station data: {str(e)}")


@app.post("/api/station/analyze", response_model=StationAnalysisResponse)
async def analyze_station_data(
    stat_code: str = Form(...),
    start_date: str = Form(default=""),
    end_date: str = Form(default=""),
    language: str = Form(default="en"),
    model_mode: str = Form(default="moondream"),
):
    """Fetch GNSS station data from LandMOS API and analyze it with AI."""
    # Resolve model mode
    mode = MODEL_MODES.get(model_mode, MODEL_MODES[DEFAULT_MODEL_MODE])
    active_text_model = mode["text_model"]

    # Ensure text model is available
    if not await ensure_model_pulled(active_text_model):
        raise HTTPException(
            503,
            detail=f"Text model '{active_text_model}' is not available. "
                   "Please check that Ollama is running.",
        )

    # Fetch station data from LandMOS API
    params = {"stat_code": stat_code}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{LANDMOS_API_BASE}/stations/data_by_stat_code",
                params=params,
            )
            if resp.status_code != 200:
                detail = resp.text[:300] if resp.text else f"status {resp.status_code}"
                raise HTTPException(502, detail=f"LandMOS API error: {detail}")
            station_data = resp.json()
    except httpx.ConnectError:
        raise HTTPException(502, detail="Cannot connect to LandMOS API server.")
    except httpx.TimeoutException:
        raise HTTPException(504, detail="LandMOS API request timed out.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching station data: {e}")
        raise HTTPException(500, detail=f"Error fetching station data: {str(e)}")

    # Pre-process station data into a compact text summary for the AI
    data_summary = _summarize_station_data(station_data, stat_code)

    # Language instruction
    if language == "th":
        lang_instruction = """IMPORTANT: You MUST respond entirely in Thai language (ภาษาไทย).
Use Thai for all explanations, descriptions, and interpretations.
Technical terms like GNSS, ITRF, mm/year can remain in English, but all sentences must be in Thai."""
    else:
        lang_instruction = "Please respond in English."

    # ── Step 1: Detailed analysis ──────────────────────────────────
    analysis_prompt = f"""You are an expert geodetic engineer analyzing GNSS monitoring data from station {stat_code}.

Field definitions:
- de, dn, dh = displacement from initial coordinate in East, North, and Height (meters)
- sde, sdn, sdh = standard deviation of each displacement component (meters)
- pdop = Position Dilution of Precision (lower is better)
- no_satellite = number of satellites used

{lang_instruction}

{data_summary}

Analyze this data:
1. What is the displacement trend for East (de), North (dn), and Height (dh)?
2. Is there land subsidence (negative dh trend) or uplift?
3. What is the approximate displacement rate per year for each component?
4. Are there any anomalies or sudden jumps?
5. Comment on data quality based on S.D. values and PDOP."""

    description = await query_ollama_text(analysis_prompt, model=active_text_model, num_ctx=4096)

    if description.startswith("Error:"):
        raise HTTPException(503, detail=description)

    # ── Step 2: User-friendly summary ──────────────────────────────
    if language == "th":
        summary_lang = """IMPORTANT: Write entirely in Thai (ภาษาไทย). Use simple Thai."""
    else:
        summary_lang = "Please write in English."

    summary_prompt = f"""Based on the following technical analysis of GNSS station data (station: {stat_code}),
create a concise, easy-to-understand summary for a non-technical user.

{summary_lang}

Technical Analysis:
{description}

Write a 3-5 sentence summary that:
- Explains what was measured (ground/point movement at this station)
- Highlights the key findings (direction and amount of movement)
- Explains any potential implications
Keep it simple and informative."""

    summary = await query_ollama_text(summary_prompt, model=active_text_model, num_ctx=4096)

    if summary.startswith("Error:"):
        summary = description[:300] + "..." if len(description) > 300 else description

    chart_id = str(uuid.uuid4())[:8]

    return StationAnalysisResponse(
        id=chart_id,
        stat_code=stat_code,
        description=description,
        summary=summary,
        details={
            "text_model": active_text_model,
            "model_mode": model_mode,
            "language": language,
            "start_date": start_date,
            "end_date": end_date,
            "data_points": len(station_data) if isinstance(station_data, list) else "N/A",
        },
        station_data=station_data if isinstance(station_data, dict) else {"records": station_data},
        timestamp=datetime.now().isoformat(),
    )
