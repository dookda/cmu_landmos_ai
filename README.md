# CMU LandMOS AI — GNSS Chart Reader

> **Local AI-powered GNSS Point Displacement Chart Analyzer**  
> Reads and describes GNSS displacement charts using Ollama (LLaVA + Llama 3.2) — all running privately on your machine.

![Architecture](https://img.shields.io/badge/Architecture-Docker%20Compose-blue)
![AI](https://img.shields.io/badge/AI-Ollama%20LLaVA-purple)
![Backend](https://img.shields.io/badge/Backend-FastAPI-green)

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Backend       │     │   Ollama        │
│   (Nginx)       │────▶│   (FastAPI)     │────▶│   (LLM Server)  │
│   Port: 3000    │     │   Port: 8000    │     │   Port: 11434   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                  │ LLaVA 7B (Vision)
                                                  │ Llama 3.2 3B (Text)
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose installed
- At least **8GB RAM** (recommended 16GB for smooth operation)
- ~10GB disk space for AI models

### Run

```bash
# Start all services
docker compose up -d --build

# Watch logs
docker compose logs -f

# Open the app
open http://localhost:3000
```

### First Run
On the first run, models will be automatically downloaded (~4.7GB for LLaVA + ~2GB for Llama 3.2). This may take several minutes depending on your internet speed.

## 📊 Features

### 1. Upload Charts
Upload your GNSS displacement chart images (PNG, JPG, etc.) and get AI-powered analysis.

### 2. Generate Sample Charts
Generate realistic sample GNSS point displacement charts for testing with:
- **East component** — horizontal displacement trend
- **North component** — horizontal displacement trend  
- **Up component** — vertical displacement (subsidence)
- Including seasonal variations and noise

### 3. AI Analysis
The AI uses **LLaVA** (Large Language and Vision Assistant) to:
- Read chart axes, labels, and data points
- Identify displacement trends (linear, seasonal)
- Detect anomalies and sudden jumps
- Estimate displacement rates (mm/year)
- Assess data quality and noise levels

### 4. Chat with AI
Ask follow-up questions about the analyzed chart:
- "What is the subsidence rate?"
- "Is the seasonal variation normal?"
- "What does this displacement pattern suggest?"

## 🛠️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| AI Engine | Ollama + LLaVA 7B | Vision-based chart reading |
| Text AI | Ollama + Llama 3.2 3B | Summary generation & chat |
| Backend | FastAPI (Python) | API, chart generation, AI orchestration |
| Frontend | HTML/CSS/JS | Premium dark UI |
| Proxy | Nginx | Static files & API proxy |
| Container | Docker Compose | Service orchestration |

## 🔧 Configuration

### Environment Variables (Backend)

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Ollama server URL |
| `VISION_MODEL` | `llava:7b` | Vision model name |
| `TEXT_MODEL` | `llama3.2:3b` | Text model name |

### GPU Support (Optional)

To enable GPU acceleration, uncomment the GPU section in `docker-compose.yml`:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

## 📁 Project Structure

```
cmu_landmos_ai/
├── docker-compose.yml      # Service orchestration
├── backend/
│   ├── Dockerfile          # Python backend image
│   ├── requirements.txt    # Python dependencies
│   └── main.py             # FastAPI application
├── frontend/
│   ├── Dockerfile          # Nginx frontend image
│   ├── nginx.conf          # Nginx configuration
│   ├── index.html          # Main HTML
│   ├── styles.css          # Premium dark theme
│   └── app.js              # Frontend logic
└── README.md
```

## 📝 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/models/status` | Check AI model availability |
| POST | `/api/generate-sample` | Generate sample GNSS chart |
| POST | `/api/analyze` | Upload & analyze chart |
| POST | `/api/chat` | Chat about analyzed chart |
| GET | `/api/charts/{filename}` | Get chart image |
| GET | `/api/analyses` | List all analyses |
| GET | `/api/analyses/{id}` | Get specific analysis |

## 🎓 About GNSS Point Displacement

GNSS (Global Navigation Satellite System) point displacement monitoring is used to:
- **Structural Health Monitoring** — Track movements of dams, bridges, and buildings
- **Land Subsidence Detection** — Monitor ground sinking in urban areas
- **Tectonic Motion** — Measure plate movements and earthquake-related deformation
- **Landslide Early Warning** — Detect slope instabilities

The displacement is typically measured in three components:
- **East (E)** — Horizontal movement in the east-west direction
- **North (N)** — Horizontal movement in the north-south direction
- **Up (U)** — Vertical movement (positive = uplift, negative = subsidence)

---

**CMU LandMOS AI** • Chiang Mai University • Land Monitoring System
