/**
 * CMU LandMOS AI — GNSS Chart Reader
 * Frontend Application Logic
 */

// ── State ────────────────────────────────────────────────────────────
let currentChartId = null;
let currentFile = null;
let currentLang = localStorage.getItem('lang') || 'th';
let currentModelMode = localStorage.getItem('modelMode') || 'moondream';
let currentTheme = localStorage.getItem('theme') || 'dark';

// ── DOM Elements ─────────────────────────────────────────────────────
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const fileNameEl = document.getElementById('fileName');
const analysisPanel = document.getElementById('analysisPanel');
const chartImage = document.getElementById('chartImage');
const loadingPanel = document.getElementById('loadingPanel');
const resultsPanel = document.getElementById('resultsPanel');
const summaryContent = document.getElementById('summaryContent');
const detailContent = document.getElementById('detailContent');
const statusBadge = document.getElementById('statusBadge');

// ── Initialize ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setTheme(currentTheme);
    setLanguage(currentLang);
    setModelMode(currentModelMode);
    checkModelStatus();
    setupDragDrop();
    setupFileInput();

    // Periodically check status
    setInterval(checkModelStatus, 30000);
});

// ── Language Switching ──────────────────────────────────────────────
function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);

    // Update toggle buttons
    document.getElementById('langBtnEN').classList.toggle('active', lang === 'en');
    document.getElementById('langBtnTH').classList.toggle('active', lang === 'th');

    // Update all elements with data-en / data-th attributes
    document.querySelectorAll('[data-en][data-th]').forEach(el => {
        const text = el.getAttribute(`data-${lang}`);
        if (text) el.innerHTML = text;
    });

    // Update placeholders
    document.querySelectorAll('[data-placeholder-en][data-placeholder-th]').forEach(el => {
        const ph = el.getAttribute(`data-placeholder-${lang}`);
        if (ph) el.placeholder = ph;
    });
}

// ── Theme Switching ─────────────────────────────────────────────────
function setTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('theme', theme);

    document.documentElement.setAttribute('data-theme', theme);

    document.getElementById('themeBtnLight').classList.toggle('active', theme === 'light');
    document.getElementById('themeBtnDark').classList.toggle('active', theme === 'dark');
}

// ── Model Mode Switching ────────────────────────────────────────────
function setModelMode(mode) {
    currentModelMode = mode;
    localStorage.setItem('modelMode', mode);

    // Update model card active states
    document.querySelectorAll('.model-card').forEach(card => {
        card.classList.remove('active');
    });
    const activeCard = document.getElementById(`modelCard_${mode}`);
    if (activeCard) activeCard.classList.add('active');
}

// ── Model Status Check ──────────────────────────────────────────────
async function checkModelStatus() {
    try {
        const resp = await fetch('/api/models/status');
        const data = await resp.json();

        const dot = statusBadge.querySelector('.status-dot');
        const text = statusBadge.querySelector('.status-text');

        if (data.ollama_status === 'connected') {
            if (data.vision_model_ready && data.text_model_ready) {
                dot.className = 'status-dot connected';
                text.textContent = currentLang === 'th' ? 'AI พร้อมใช้งาน' : 'AI Ready';
                showToast(currentLang === 'th' ? 'โมเดล AI เชื่อมต่อและพร้อมใช้งานแล้ว!' : 'AI models connected and ready!', 'success');
            } else {
                dot.className = 'status-dot';
                text.textContent = currentLang === 'th' ? 'โมเดลกำลังโหลด...' : 'Models loading...';
                showToast(currentLang === 'th' ? 'กำลังดาวน์โหลดโมเดล AI อาจใช้เวลาสักครู่ในการรันครั้งแรก' : 'Models are being pulled. This may take a few minutes on first run.', 'info');
            }

            // Update per-model status indicators
            if (data.available_modes) {
                Object.entries(data.available_modes).forEach(([key, info]) => {
                    const statusDot = document.getElementById(`modelStatus_${key}`);
                    if (statusDot) {
                        if (info.ready) {
                            statusDot.className = 'model-status-dot ready';
                            statusDot.title = currentLang === 'th' ? 'พร้อมใช้งาน' : 'Ready';
                        } else {
                            statusDot.className = 'model-status-dot loading';
                            statusDot.title = currentLang === 'th' ? 'กำลังโหลด...' : 'Loading...';
                        }
                    }
                });
            }
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = currentLang === 'th' ? 'Ollama ไม่ได้เชื่อมต่อ' : 'Ollama disconnected';
        }
    } catch (e) {
        const dot = statusBadge.querySelector('.status-dot');
        const text = statusBadge.querySelector('.status-text');
        dot.className = 'status-dot disconnected';
        text.textContent = currentLang === 'th' ? 'ไม่ได้เชื่อมต่อ' : 'Backend offline';
    }
}

// ── File Upload ─────────────────────────────────────────────────────
function setupFileInput() {
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            currentFile = file;
            fileNameEl.textContent = file.name;
            uploadAndPreview(file);
        }
    });
}

async function uploadAndPreview(file) {
    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
        chartImage.src = e.target.result;
        analysisPanel.style.display = 'block';
        resultsPanel.style.display = 'none';
        loadingPanel.style.display = 'none';

        // Scroll to chart
        analysisPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    reader.readAsDataURL(file);
}

// ── Analyze Chart with AI ───────────────────────────────────────────
async function analyzeCurrentChart() {
    // Show loading
    loadingPanel.style.display = 'block';
    resultsPanel.style.display = 'none';
    loadingPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Animate loading steps
    animateLoadingSteps();

    try {
        let resp;

        if (!currentFile) {
            throw new Error(currentLang === 'th' ? 'ไม่มีกราฟให้วิเคราะห์ กรุณาอัปโหลดกราฟก่อน' : 'No chart to analyze. Please upload a chart first.');
        }

        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('language', currentLang);
        formData.append('model_mode', currentModelMode);

        resp = await fetch('/api/analyze', {
            method: 'POST',
            body: formData,
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            const detail = err.detail || '';
            if (resp.status === 503) {
                const prefix = currentLang === 'th'
                    ? 'โมเดล AI ไม่พร้อม: '
                    : 'AI model not ready: ';
                throw new Error(prefix + (detail || 'Please check that Ollama is running.'));
            }
            throw new Error(detail || 'Analysis failed');
        }

        const data = await resp.json();
        currentChartId = data.id;

        // Display results
        displayResults(data);
        showToast(currentLang === 'th' ? 'วิเคราะห์กราฟเสร็จสมบูรณ์!' : 'Chart analysis complete!', 'success');
    } catch (err) {
        showToast('Analysis error: ' + err.message, 'error');
        loadingPanel.style.display = 'none';
    }
}

function animateLoadingSteps() {
    const steps = ['step1', 'step2', 'step3'];
    let current = 0;

    const interval = setInterval(() => {
        if (current > 0) {
            document.getElementById(steps[current - 1]).classList.remove('active');
            document.getElementById(steps[current - 1]).classList.add('done');
            document.getElementById(steps[current - 1]).querySelector('.step-icon').textContent = '✅';
        }

        if (current < steps.length) {
            document.getElementById(steps[current]).classList.add('active');
            current++;
        } else {
            clearInterval(interval);
        }
    }, 8000);

    // Store interval ID for cleanup
    window._loadingInterval = interval;
}

function displayResults(data) {
    // Stop loading animation
    if (window._loadingInterval) clearInterval(window._loadingInterval);

    loadingPanel.style.display = 'none';
    resultsPanel.style.display = 'block';

    // Summary
    summaryContent.textContent = data.summary || 'No summary available.';

    // Detailed analysis
    detailContent.textContent = data.description || 'No detailed analysis available.';

    resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Toggle Detail Section ───────────────────────────────────────────
function toggleDetail() {
    const content = document.getElementById('detailContent');
    const arrow = document.getElementById('toggleArrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
}

// ── Drag & Drop ─────────────────────────────────────────────────────
function setupDragDrop() {
    let dragCounter = 0;
    let overlay = null;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) {
            overlay = document.createElement('div');
            overlay.className = 'drag-overlay';
            overlay.innerHTML = `
                <div class="drag-overlay-content">
                    <h2>${currentLang === 'th' ? 'วางกราฟ GNSS ของคุณที่นี่' : 'Drop your GNSS chart here'}</h2>
                    <p>${currentLang === 'th' ? 'ปล่อยเพื่ออัปโหลดและดูตัวอย่าง' : 'Release to upload and preview'}</p>
                </div>
            `;
            document.body.appendChild(overlay);
        }
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0 && overlay) {
            overlay.remove();
            overlay = null;
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (overlay) {
            overlay.remove();
            overlay = null;
        }

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            currentFile = files[0];
            fileNameEl.textContent = files[0].name;
            uploadAndPreview(files[0]);
        }
    });
}

// ── Toast Notifications ─────────────────────────────────────────────
let toastTimeout = null;

function showToast(message, type = 'info') {
    // Remove any existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    if (toastTimeout) clearTimeout(toastTimeout);

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    toastTimeout = setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── LandMOS Station Data ────────────────────────────────────────────
async function fetchAndAnalyzeStation() {
    const statCode = document.getElementById('stationCode').value.trim();
    if (!statCode) {
        showToast(currentLang === 'th' ? 'กรุณาใส่รหัสสถานี' : 'Please enter a station code', 'error');
        return;
    }

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    const stationPanel = document.getElementById('stationPanel');
    const stationLoadingPanel = document.getElementById('stationLoadingPanel');
    const stationResultsPanel = document.getElementById('stationResultsPanel');

    // Show station panel and loading
    stationPanel.style.display = 'block';
    stationLoadingPanel.style.display = 'block';
    stationResultsPanel.style.display = 'none';

    // Update station code badge
    document.getElementById('stationCodeBadge').textContent = statCode.toUpperCase();

    // Hide chart analysis panel if showing
    analysisPanel.style.display = 'none';

    stationPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Step 1: Fetch raw data to show preview
    try {
        let dataUrl = `/api/station/data?stat_code=${encodeURIComponent(statCode)}`;
        if (startDate) dataUrl += `&start_date=${encodeURIComponent(startDate)}`;
        if (endDate) dataUrl += `&end_date=${encodeURIComponent(endDate)}`;

        const dataResp = await fetch(dataUrl);
        if (!dataResp.ok) {
            const err = await dataResp.json().catch(() => ({}));
            throw new Error(err.detail || `Failed to fetch station data (${dataResp.status})`);
        }
        const stationData = await dataResp.json();
        displayStationDataPreview(stationData, statCode);
    } catch (err) {
        document.getElementById('stationDataInfo').textContent =
            currentLang === 'th' ? 'ไม่สามารถโหลดข้อมูลตัวอย่างได้' : 'Could not load data preview';
    }

    // Step 2: Send to AI for analysis
    try {
        const formData = new FormData();
        formData.append('stat_code', statCode);
        formData.append('language', currentLang);
        formData.append('model_mode', currentModelMode);
        if (startDate) formData.append('start_date', startDate);
        if (endDate) formData.append('end_date', endDate);

        const resp = await fetch('/api/station/analyze', {
            method: 'POST',
            body: formData,
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            const detail = err.detail || '';
            if (resp.status === 503) {
                const prefix = currentLang === 'th' ? 'โมเดล AI ไม่พร้อม: ' : 'AI model not ready: ';
                throw new Error(prefix + (detail || 'Please check that Ollama is running.'));
            }
            throw new Error(detail || 'Analysis failed');
        }

        const data = await resp.json();

        // Display results
        stationLoadingPanel.style.display = 'none';
        stationResultsPanel.style.display = 'block';

        document.getElementById('stationSummaryContent').textContent = data.summary || 'No summary available.';
        document.getElementById('stationDetailContent').textContent = data.description || 'No detailed analysis available.';

        stationResultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast(currentLang === 'th' ? 'วิเคราะห์ข้อมูลสถานีเสร็จสมบูรณ์!' : 'Station data analysis complete!', 'success');
    } catch (err) {
        showToast((currentLang === 'th' ? 'ข้อผิดพลาด: ' : 'Error: ') + err.message, 'error');
        stationLoadingPanel.style.display = 'none';
    }
}

function displayStationDataPreview(data, statCode) {
    const info = document.getElementById('stationDataInfo');
    const thead = document.getElementById('stationTableHead');
    const tbody = document.getElementById('stationTableBody');

    // Handle both array and object responses
    let records = Array.isArray(data) ? data : (data.records || data.data || []);
    if (!Array.isArray(records)) records = [];

    const total = records.length;
    info.textContent = currentLang === 'th'
        ? `สถานี ${statCode.toUpperCase()} — ${total} รายการ`
        : `Station ${statCode.toUpperCase()} — ${total} records`;

    if (total === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td style="padding:12px;color:var(--text-muted);">${currentLang === 'th' ? 'ไม่พบข้อมูล' : 'No data found'}</td></tr>`;
        return;
    }

    // Build table header from first record keys
    const keys = Object.keys(records[0]);
    thead.innerHTML = '<tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';

    // Show first 10 rows as preview
    const previewRows = records.slice(0, 10);
    tbody.innerHTML = previewRows.map(row =>
        '<tr>' + keys.map(k => `<td>${row[k] ?? ''}</td>`).join('') + '</tr>'
    ).join('');

    if (total > 10) {
        tbody.innerHTML += `<tr><td colspan="${keys.length}" style="text-align:center;color:var(--text-muted);padding:8px;">
            ${currentLang === 'th' ? `... และอีก ${total - 10} รายการ` : `... and ${total - 10} more records`}
        </td></tr>`;
    }
}

function toggleStationDetail() {
    const content = document.getElementById('stationDetailContent');
    const arrow = document.getElementById('stationToggleArrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
}

// ── Utility ─────────────────────────────────────────────────────────
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
