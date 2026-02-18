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
let echartInstance = null;
let cachedStationRecords = null;
let cachedStatCode = null;

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

    // Re-render ECharts with new theme colours if chart exists
    if (echartInstance && cachedStationRecords) {
        renderDisplacementChart(cachedStationRecords, cachedStatCode);
    }
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
    const echartSection = document.getElementById('echartSection');

    // Show station panel and loading
    stationPanel.style.display = 'block';
    stationLoadingPanel.style.display = 'block';
    stationResultsPanel.style.display = 'none';
    echartSection.style.display = 'none';

    // Update station code badge
    document.getElementById('stationCodeBadge').textContent = statCode.toUpperCase();

    // Hide chart analysis panel if showing
    analysisPanel.style.display = 'none';

    stationPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Step 1: Fetch raw data to show preview + render chart
    let stationData = null;
    try {
        let dataUrl = `/api/station/data?stat_code=${encodeURIComponent(statCode)}`;
        if (startDate) dataUrl += `&start_date=${encodeURIComponent(startDate)}`;
        if (endDate) dataUrl += `&end_date=${encodeURIComponent(endDate)}`;

        const dataResp = await fetch(dataUrl);
        if (!dataResp.ok) {
            const err = await dataResp.json().catch(() => ({}));
            throw new Error(err.detail || `Failed to fetch station data (${dataResp.status})`);
        }
        stationData = await dataResp.json();
        displayStationDataPreview(stationData, statCode);

        // Sort and cache data, then render ECharts displacement chart
        const records = Array.isArray(stationData) ? stationData : (stationData.records || stationData.data || []);
        // Sort by timestamp ascending
        records.sort((a, b) => {
            const ta = a.timestamp || a.date || '';
            const tb = b.timestamp || b.date || '';
            return ta.localeCompare(tb);
        });
        cachedStationRecords = records;
        cachedStatCode = statCode;

        if (records.length > 0) {
            echartSection.style.display = 'block';
            renderDisplacementChart(records, statCode);
        }
    } catch (err) {
        document.getElementById('stationDataInfo').textContent =
            currentLang === 'th' ? 'ไม่สามารถโหลดข้อมูลตัวอย่างได้' : 'Could not load data preview';
    }

    // Step 2: Send to AI for analysis (text-only, quick)
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

// ── ECharts Displacement Chart ──────────────────────────────────────
function renderDisplacementChart(records, statCode) {
    const chartDom = document.getElementById('displacementChart');
    if (!chartDom) return;

    // Dispose previous instance if exists
    if (echartInstance) {
        echartInstance.dispose();
    }
    echartInstance = echarts.init(chartDom, currentTheme === 'dark' ? 'dark' : null);

    // Extract data
    const timestamps = records.map(r => {
        const ts = r.timestamp || r.date || '';
        // Show only date part if full ISO timestamp
        return ts.length > 10 ? ts.substring(0, 10) : ts;
    });
    const deData = records.map(r => parseFloat(r.de) || null);
    const dnData = records.map(r => parseFloat(r.dn) || null);
    const dhData = records.map(r => parseFloat(r.dh) || null);

    const isDark = currentTheme === 'dark';

    const option = {
        backgroundColor: 'transparent',
        title: {
            text: currentLang === 'th'
                ? `การเคลื่อนตัวของสถานี ${statCode.toUpperCase()}`
                : `Displacement — Station ${statCode.toUpperCase()}`,
            left: 'center',
            textStyle: {
                color: isDark ? '#eef0ff' : '#1a1a2e',
                fontSize: 15,
                fontFamily: 'Inter, sans-serif',
                fontWeight: 700,
            },
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: isDark ? 'rgba(22,22,56,0.95)' : 'rgba(255,255,255,0.97)',
            borderColor: isDark ? 'rgba(124,58,237,0.3)' : 'rgba(109,40,217,0.15)',
            textStyle: { color: isDark ? '#eef0ff' : '#1a1a2e', fontSize: 12 },
            axisPointer: { type: 'cross', lineStyle: { color: '#7c3aed', opacity: 0.4 } },
        },
        legend: {
            bottom: 0,
            textStyle: { color: isDark ? '#9ba3c7' : '#4a4a6a', fontSize: 12 },
            data: [
                { name: 'East (de)', icon: 'roundRect' },
                { name: 'North (dn)', icon: 'roundRect' },
                { name: 'Height (dh)', icon: 'roundRect' },
            ],
        },
        grid: { left: 60, right: 24, top: 50, bottom: 50, containLabel: false },
        xAxis: {
            type: 'category',
            data: timestamps,
            axisLabel: {
                color: isDark ? '#6b73a0' : '#8888a8',
                fontSize: 10,
                rotate: timestamps.length > 30 ? 45 : 0,
                formatter: (val) => val.substring(5), // show MM-DD
            },
            axisLine: { lineStyle: { color: isDark ? '#2a2a4e' : '#d0d0e0' } },
            splitLine: { show: false },
        },
        yAxis: {
            type: 'value',
            name: currentLang === 'th' ? 'การเคลื่อนตัว (m)' : 'Displacement (m)',
            nameTextStyle: { color: isDark ? '#6b73a0' : '#8888a8', fontSize: 11 },
            axisLabel: { color: isDark ? '#6b73a0' : '#8888a8', fontSize: 10 },
            axisLine: { lineStyle: { color: isDark ? '#2a2a4e' : '#d0d0e0' } },
            splitLine: { lineStyle: { color: isDark ? 'rgba(124,58,237,0.08)' : 'rgba(109,40,217,0.06)' } },
        },
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            {
                type: 'slider', start: 0, end: 100, height: 20, bottom: 30,
                borderColor: isDark ? '#2a2a4e' : '#d0d0e0',
                fillerColor: isDark ? 'rgba(0,212,255,0.15)' : 'rgba(0,153,204,0.12)',
                handleStyle: { color: '#7c3aed' },
                textStyle: { color: isDark ? '#6b73a0' : '#8888a8', fontSize: 10 },
            },
        ],
        series: [
            {
                name: 'East (de)',
                type: 'line',
                data: deData,
                symbol: 'circle',
                symbolSize: 3,
                lineStyle: { width: 1.8, color: '#00d4ff' },
                itemStyle: { color: '#00d4ff' },
                smooth: false,
                emphasis: { focus: 'series' },
            },
            {
                name: 'North (dn)',
                type: 'line',
                data: dnData,
                symbol: 'circle',
                symbolSize: 3,
                lineStyle: { width: 1.8, color: '#00ff88' },
                itemStyle: { color: '#00ff88' },
                smooth: false,
                emphasis: { focus: 'series' },
            },
            {
                name: 'Height (dh)',
                type: 'line',
                data: dhData,
                symbol: 'circle',
                symbolSize: 3,
                lineStyle: { width: 1.8, color: '#ff6b6b' },
                itemStyle: { color: '#ff6b6b' },
                smooth: false,
                emphasis: { focus: 'series' },
            },
        ],
    };

    echartInstance.setOption(option);

    // Auto-resize on window resize
    window.addEventListener('resize', () => {
        if (echartInstance) echartInstance.resize();
    });
}

// ── Analyze Station with Chart Image (Vision + Text) ────────────────
async function analyzeStationWithChart() {
    if (!echartInstance) {
        showToast(currentLang === 'th' ? 'ไม่มีกราฟให้วิเคราะห์' : 'No chart to analyze', 'error');
        return;
    }

    const stationLoadingPanel = document.getElementById('stationLoadingPanel');
    const stationResultsPanel = document.getElementById('stationResultsPanel');

    stationLoadingPanel.style.display = 'block';
    stationResultsPanel.style.display = 'none';
    stationLoadingPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
        // Capture ECharts as base64 PNG (dataURL)
        // Optimization: Reduced pixelRatio from 2 to 1.5 for faster upload/processing
        const chartDataUrl = echartInstance.getDataURL({
            type: 'png',
            pixelRatio: 1.5,
            backgroundColor: currentTheme === 'dark' ? '#0d0d20' : '#ffffff',
        });

        // Convert data URL to Blob for FormData
        const chartBlob = await (await fetch(chartDataUrl)).blob();

        const statCode = cachedStatCode || document.getElementById('stationCode').value.trim();
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        const formData = new FormData();
        formData.append('stat_code', statCode);
        formData.append('language', currentLang);
        formData.append('model_mode', currentModelMode);
        formData.append('chart_image', chartBlob, 'displacement_chart.png');
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

        stationLoadingPanel.style.display = 'none';
        stationResultsPanel.style.display = 'block';

        document.getElementById('stationSummaryContent').textContent = data.summary || 'No summary available.';
        document.getElementById('stationDetailContent').textContent = data.description || 'No detailed analysis available.';

        stationResultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast(
            currentLang === 'th'
                ? 'วิเคราะห์กราฟ + ข้อมูลสถานีเสร็จสมบูรณ์!'
                : 'Chart + station data analysis complete!',
            'success'
        );
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
