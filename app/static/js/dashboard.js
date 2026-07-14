// ============================================================
// app/static/js/dashboard.js
// ============================================================

const DEFAULT_CITY = 'Оренбург';
const ORSK_CENTER = [51.2045, 58.5669];
const ORENBURG_CENTER = [51.7682, 55.0970];

function getCityCenter(city) {
    if (city === 'Орск') return ORSK_CENTER;
    return ORENBURG_CENTER;
}

let map = null;
let clusterer = null;
let clusterEnabled = true;
let mapFullscreen = false;
let mapInitialized = false;

let addedMarkerIds = new Set();
let allPlacemarks = [];

let scenarioData = null;
let isPlaying = false;
let playInterval = null;
let speed = 1;
let chart = null;

let currentCity = DEFAULT_CITY;
let currentDate = '';
let timeRangeHours = 24;
let currentTimeRange = '24h';
let availableDates = [];
let calendarDate = new Date();

// ============================================================
// 1. API
// ============================================================

async function loadAvailableCities() {
    try {
        const response = await fetch('/api/cities');
        const cities = await response.json();
        const citySelect = document.getElementById('citySelect');
        citySelect.innerHTML = '';
        if (!cities || cities.length === 0) {
            citySelect.innerHTML = '<option value="Оренбург">Оренбург</option>';
            return ['Оренбург'];
        }
        cities.forEach(city => {
            const option = document.createElement('option');
            option.value = city;
            option.textContent = city;
            citySelect.appendChild(option);
        });
        return cities;
    } catch (error) {
        console.error('Ошибка загрузки городов:', error);
        return ['Оренбург'];
    }
}

async function loadAvailableDates(city) {
    try {
        const response = await fetch(`/api/dates?city=${encodeURIComponent(city)}`);
        const dates = await response.json();
        availableDates = dates || [];
        dates.sort((a, b) => new Date(a) - new Date(b));
        
        const dateSelect = document.getElementById('dateSelect');
        if (!dateSelect) {
            const hiddenSelect = document.createElement('select');
            hiddenSelect.id = 'dateSelect';
            hiddenSelect.style.display = 'none';
            document.body.appendChild(hiddenSelect);
        }
        const select = document.getElementById('dateSelect');
        select.innerHTML = '';
        if (!dates || dates.length === 0) {
            select.innerHTML = '<option value="">Нет данных</option>';
            return null;
        }
        dates.forEach(date => {
            const option = document.createElement('option');
            option.value = date;
            option.textContent = formatDate(date);
            select.appendChild(option);
        });
        currentDate = dates[dates.length - 1];
        select.value = currentDate;
        document.getElementById('selectedDateDisplay').textContent = formatDate(currentDate);
        renderCalendar();
        return currentDate;
    } catch (error) {
        console.error('Ошибка загрузки дат:', error);
        return null;
    }
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function loadScenarioByCity(progress = 0) {
    const city = document.getElementById('citySelect')?.value || currentCity;
    const dateSelect = document.getElementById('dateSelect');
    const date = dateSelect?.value || currentDate;
    if (!date) {
        console.warn('Нет выбранной даты');
        return null;
    }
    currentCity = city;
    currentDate = date;
    if (progress === 0) {
        addedMarkerIds.clear();
        if (clusterer) clusterer.removeAll();
        allPlacemarks = [];
        const center = getCityCenter(city);
        if (map) map.setCenter(center, 13);
    }
    return await loadScenarioForCityDate(city, date, progress);
}

async function loadScenarioForCityDate(city, date, progress = 0) {
    try {
        const startDate = new Date(date);
        const endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
        const totalMs = endDate.getTime() - startDate.getTime();
        const currentMs = startDate.getTime() + (totalMs * progress / 100);
        const currentTime = new Date(currentMs);
        
        const url = `/api/scenario_by_city?city=${encodeURIComponent(city)}&date=${date}&current_time=${currentTime.toISOString()}&time_range=${timeRangeHours}`;
        const response = await fetch(url);
        const data = await response.json();
        
        scenarioData = data;
        updateDashboard(data);
        updateTimeline(progress, currentTime);
        updateChart(data);
        
        // Обновляем карту
        addedMarkerIds.clear();
        if (clusterer) clusterer.removeAll();
        allPlacemarks = [];
        const activeTypes = getActiveFilters();
        const filteredMarkers = data.markers.filter(m => activeTypes.includes(m.type));
        filteredMarkers.forEach(marker => {
            const placemark = createYandexPlacemark(marker);
            clusterer.add(placemark);
            addedMarkerIds.add(marker.id);
            allPlacemarks.push(placemark);
        });
        
        const callsInfo = document.getElementById('callsInfo');
        if (callsInfo) callsInfo.textContent = `Вызовов: ${data.total_calls || 0}`;
        return data;
    } catch (error) {
        console.error('Ошибка загрузки сценария:', error);
        return null;
    }
}

// ============================================================
// 2. UI
// ============================================================

function updateDashboard(data) {
    const loadFactor = data.current_load || 1.0;
    const totalCalls = data.total_calls || 0;
    document.getElementById('coeffDisplay').innerHTML = loadFactor.toFixed(2) + ' <span>от нормы</span>';
    document.getElementById('totalCalls').textContent = totalCalls;
    
    const statusBar = document.getElementById('statusBar');
    const statusLabel = document.getElementById('statusLabel');
    const alertBanner = document.getElementById('alertBanner');
    const alertText = document.getElementById('alertText');
    statusBar.className = 'status-bar';
    alertBanner.className = 'alert-banner';
    if (loadFactor >= 3.0) {
        statusBar.classList.add('critical');
        statusLabel.innerHTML = '🔴 КРИТИЧЕСКАЯ СИТУАЦИЯ!';
        alertBanner.classList.add('show');
        alertText.textContent = '🚨 КРИТИЧЕСКОЕ ПРЕВЫШЕНИЕ! Коэффициент превышает 3.0!';
    } else if (loadFactor >= 1.5) {
        statusBar.classList.add('danger');
        statusLabel.innerHTML = '🟠 ПРЕВЫШЕНИЕ ПОРОГА (> 1.5)';
        alertBanner.classList.add('show');
        alertText.textContent = '⚠️ Превышение порога 1.5. Возможно развитие ЧС.';
    } else if (loadFactor >= 1.2) {
        statusBar.classList.add('warning');
        statusLabel.innerHTML = '🟡 ПОВЫШЕННАЯ НАГРУЗКА (> 1.2)';
        alertBanner.className = 'alert-banner';
    } else if (loadFactor < 0.2 && totalCalls > 0) {
        statusBar.classList.add('danger');
        statusLabel.innerHTML = '📵 АНОМАЛЬНОЕ ПАДЕНИЕ';
        alertBanner.classList.add('show');
        alertText.textContent = '📵 Зафиксировано аномальное падение количества вызовов.';
    } else {
        statusLabel.innerHTML = '🟢 ШТАТНЫЙ РЕЖИМ';
        alertBanner.className = 'alert-banner';
    }
    updateIncidentTable(data.incidents || {});
    updateServiceLegend(data.markers || []);
}

function updateIncidentTable(incidents) {
    const tbody = document.getElementById('incidentTable');
    const total = Object.values(incidents).reduce((a, b) => a + b, 0);
    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#64748b;">Нет данных</td></tr>';
        return;
    }
    const sorted = Object.entries(incidents).sort((a, b) => b[1] - a[1]);
    tbody.innerHTML = '';
    sorted.forEach(([type, count]) => {
        const percent = (count / total * 100).toFixed(1);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><strong>${type}</strong></td><td>${count}</td><td>${percent}%</td>`;
        tbody.appendChild(tr);
    });
}

function updateServiceLegend(markers) {
    const container = document.getElementById('serviceLegend');
    if (!container) return;
    const services = new Set();
    markers.forEach(m => { if (m.services) m.services.forEach(s => services.add(s)); });
    const colors = {
        'ДДС-01': '#ef4444', 'ДДС-02': '#3b82f6', 'ДДС-03': '#22c55e', 'ДДС-04': '#f97316',
        'Антитеррор': '#8b5cf6', 'ЦУКС': '#06b6d4', 'ЕДДС': '#10b981', 'CONSULT': '#f59e0b'
    };
    const names = {
        'ДДС-01': '🔥 Пожарная', 'ДДС-02': '👮 Полиция', 'ДДС-03': '🚑 Скорая', 'ДДС-04': '💨 Газовая',
        'Антитеррор': '🛡️ Антитеррор', 'ЦУКС': '📡 ЦУКС', 'ЕДДС': '📞 ЕДДС', 'CONSULT': '💬 Консультация'
    };
    container.innerHTML = '<span style="color:#94a3b8; font-size:12px;">Службы и категории:</span>';
    services.forEach(s => {
        container.innerHTML += `<span><span class="dot" style="background:${colors[s] || '#60a5fa'};"></span>${names[s] || s}</span>`;
    });
}

function updateTimeline(progress, currentTime) {
    document.getElementById('progressLabel').textContent = Math.round(progress) + '%';
    document.getElementById('timelineSlider').value = progress;
    document.getElementById('simTimeLabel').textContent = currentTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('currentDateDisplay').textContent = currentTime.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('currentTimeDisplay').textContent = currentTime.toLocaleTimeString('ru-RU');
    document.getElementById('currentDateDisplay2').textContent = currentTime.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============================================================
// 3. ГРАФИК
// ============================================================

function updateChart(data) {
    const ctx = document.getElementById('loadChart').getContext('2d');
    const loadFactors = data.load_factors || [];
    const timestamps = data.timestamps || [];
    if (chart) chart.destroy();
    if (loadFactors.length === 0) {
        chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ data: [] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }
    const FIXED_MAX = 5.0;
    const FIXED_MIN = 0;
    const rangeMap = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720, '90d': 2160, '365d': 8760 };
    const maxPoints = rangeMap[currentTimeRange] || 24;
    let startIndex = Math.max(0, loadFactors.length - maxPoints);
    const displayData = loadFactors.slice(startIndex);
    const displayLabels = timestamps.slice(startIndex).map(t => {
        const date = new Date(t);
        return date.getHours().toString().padStart(2, '0') + ':00';
    });
    const colors = displayData.map(val => {
        if (val >= 3.0) return '#ef4444';
        if (val >= 1.5) return '#f97316';
        if (val >= 1.2) return '#eab308';
        return '#22c55e';
    });
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [{
                label: 'Коэффициент нагрузки',
                data: displayData,
                borderColor: '#60a5fa',
                borderWidth: 3,
                pointBackgroundColor: colors,
                pointBorderColor: colors.map(c => c === '#22c55e' ? '#15803d' : c === '#eab308' ? '#a16207' : c === '#f97316' ? '#c2410c' : '#b91c1c'),
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7,
                backgroundColor: 'rgba(96, 165, 250, 0.05)',
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,15,26,0.9)',
                    titleColor: '#e0e0e0',
                    bodyColor: '#94a3b8',
                    borderColor: '#1e2a3a',
                    borderWidth: 1,
                    callbacks: {
                        afterBody: function(context) {
                            const val = context[0].parsed.y;
                            if (val >= 3.0) return '🚨 КРИТИЧЕСКОЕ ПРЕВЫШЕНИЕ!';
                            if (val >= 1.5) return '⚠️ Превышение порога 1.5';
                            if (val >= 1.2) return '⚡ Внимание, рост нагрузки';
                            if (val < 0.2) return '📵 Аномальное падение';
                            return '✅ В пределах нормы';
                        }
                    }
                },
                zoom: {
                    pan: { enabled: true, mode: 'x', rangeMin: { x: 0, y: FIXED_MIN }, rangeMax: { x: loadFactors.length, y: FIXED_MAX } },
                    zoom: { enabled: true, mode: 'x', wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, rangeMin: { x: 3, y: FIXED_MIN } }
                }
            },
            scales: {
                y: { min: FIXED_MIN, max: FIXED_MAX, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 0.5 } },
                x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8', maxTicksLimit: 12 } }
            }
        }
    });
}

function setChartRange(range) {
    currentTimeRange = range;
    document.querySelectorAll('.chart-range-btn').forEach(btn => {
        btn.style.borderColor = '#2a3a4a';
        btn.style.color = '#c0d0e0';
        if (btn.dataset.range === range) {
            btn.style.borderColor = '#60a5fa';
            btn.style.color = '#60a5fa';
        }
    });
    if (scenarioData) updateChart(scenarioData);
}

function setTimeRange(hours) {
    timeRangeHours = hours;
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.style.borderColor = '#2a3a4a';
        btn.style.color = '#c0d0e0';
        if (parseInt(btn.dataset.hours) === hours) {
            btn.style.borderColor = '#60a5fa';
            btn.style.color = '#60a5fa';
        }
    });
    // Перезагружаем карту с новой длительностью
    const city = document.getElementById('citySelect')?.value || currentCity;
    const dateSelect = document.getElementById('dateSelect');
    const date = dateSelect?.value || currentDate;
    if (date) {
        const progress = parseFloat(document.getElementById('timelineSlider')?.value || 0);
        loadScenarioForCityDate(city, date, progress);
    }
}

// ============================================================
// 4. КАРТА
// ============================================================

function initYandexMap() {
    if (mapInitialized) return;
    ymaps.ready(function() {
        map = new ymaps.Map('map', {
            center: ORENBURG_CENTER,
            zoom: 12,
            controls: ['zoomControl']
        });
        map.options.set('preset', 'dark');
        clusterer = new ymaps.Clusterer({
            gridSize: 64,
            clusterIconLayout: 'default#pieChart',
            clusterIconColors: ['#22c55e', '#eab308', '#f97316', '#ef4444'],
            clusterIconPieValues: [10, 20, 50],
            clusterIconPieRadius: 20
        });
        map.geoObjects.add(clusterer);
        mapInitialized = true;
        initializeDashboard();
    });
}

function createYandexPlacemark(marker) {
    const color = marker.color || '#60a5fa';
    const icon = marker.icon || '📌';
    const description = marker.description || marker.type || 'Вызов';
    
    const serviceNames = {
        'ДДС-01': 'Пожарная служба',
        'ДДС-02': 'Полиция',
        'ДДС-03': 'Скорая помощь',
        'ДДС-04': 'Газовая служба',
        'Антитеррор': 'Антитеррор',
        'ЦУКС': 'ЦУКС',
        'ЕДДС': 'ЕДДС',
        'CONSULT': 'Консультация'
    };
    
    const servicesList = (marker.services || []).map(s => serviceNames[s] || s).join(', ') || 'Не указаны';
    const timeStr = new Date(marker.created_at).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    
    const placemark = new ymaps.Placemark(
        [marker.lat, marker.lng],
        {
            balloonContentBody: `
                <div style="padding: 12px; min-width: 220px; max-width: 320px; font-family: 'Segoe UI', sans-serif; color: #333;">
                    <div style="font-size: 20px; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">${icon}</span>
                        <span>${marker.type || 'Вызов'}</span>
                    </div>
                    <div style="font-size: 14px; color: #333; margin-bottom: 6px; padding: 6px 10px; background: #f0f4f8; border-radius: 6px;">
                        ${description}
                    </div>
                    <div style="font-size: 13px; color: #555; margin-top: 6px; border-top: 1px solid #eee; padding-top: 6px;">
                        <div><strong>📍 Адрес:</strong> ${marker.address || 'Не указан'}</div>
                        <div><strong>🕐 Время:</strong> ${timeStr}</div>
                        <div><strong>🛠 Службы:</strong> ${servicesList}</div>
                        <div style="font-size: 11px; color: #999; margin-top: 4px;">
                            📍 ${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}
                        </div>
                    </div>
                </div>
            `,
            hintContent: `${icon} ${marker.type} — ${description.substring(0, 30)}${description.length > 30 ? '...' : ''}`
        },
        {
            iconLayout: ymaps.templateLayoutFactory.createClass(
                `<div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                    <div style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 10px solid ${color};"></div>
                    <div style="width: 28px; height: 28px; background: ${color}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.2); margin-bottom: 6px; animation: popIn 0.3s ease;">
                        ${icon}
                    </div>
                </div>
                <style>@keyframes popIn { 0% { transform: scale(0); opacity: 0; } 70% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }</style>`
            ),
            iconOffset: [-18, -36],
            iconAnimation: true,
            hasBalloon: true,
            balloonMaxWidth: 400,
            balloonPanelMaxMapArea: 0
        }
    );
    
    // Принудительный обработчик клика
    placemark.events.add('click', function(e) {
        this.balloon.open();
    });
    
    return placemark;
}

function updateMapIncremental(markers) {
    if (!mapInitialized || !clusterer) return;
    const activeTypes = getActiveFilters();
    const filteredMarkers = markers.filter(m => activeTypes.includes(m.type));
    const newMarkers = filteredMarkers.filter(m => !addedMarkerIds.has(m.id));
    if (newMarkers.length === 0) return;
    newMarkers.forEach(marker => {
        const placemark = createYandexPlacemark(marker);
        clusterer.add(placemark);
        addedMarkerIds.add(marker.id);
        allPlacemarks.push(placemark);
    });
    if (newMarkers.length > 0 && filteredMarkers.length === newMarkers.length) {
        const coords = filteredMarkers.map(m => [m.lat, m.lng]);
        if (coords.length > 1) map.setBounds(coords, { checkZoomRange: true, zoomMargin: 40 });
    }
}

// ============================================================
// 5. УПРАВЛЕНИЕ
// ============================================================

function togglePlay() {
    isPlaying = !isPlaying;
    const btn = document.getElementById('playBtn');
    if (isPlaying) {
        btn.innerHTML = '<i class="fas fa-pause"></i> Пауза';
        btn.classList.add('active');
        startPlayback();
    } else {
        btn.innerHTML = '<i class="fas fa-play"></i> Воспроизвести';
        btn.classList.remove('active');
        stopPlayback();
    }
}

function startPlayback() {
    if (playInterval) clearInterval(playInterval);
    const step = 0.3 * speed;
    playInterval = setInterval(() => {
        const slider = document.getElementById('timelineSlider');
        let value = parseFloat(slider.value) + step;
        if (value >= 100) { value = 100; togglePlay(); }
        slider.value = value;
        onSliderChange(value);
    }, 100);
}

function stopPlayback() {
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
}

function resetScenario() {
    stopPlayback();
    isPlaying = false;
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-play"></i> Воспроизвести';
    document.getElementById('playBtn').classList.remove('active');
    document.getElementById('timelineSlider').value = 0;
    addedMarkerIds.clear();
    if (clusterer) clusterer.removeAll();
    allPlacemarks = [];
    onSliderChange(0);
}

function speedUp() {
    const speeds = [0.5, 1, 2, 4, 8];
    let index = speeds.indexOf(speed);
    index = (index + 1) % speeds.length;
    speed = speeds[index];
    document.getElementById('speedLabel').textContent = speed + 'x';
    if (isPlaying) { stopPlayback(); startPlayback(); }
}

function onSliderChange(value) {
    const progress = parseFloat(value);
    loadScenarioByCity(progress);
}

function getActiveFilters() {
    const checkboxes = document.querySelectorAll('.filter-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function applyFilters() {
    const activeTypes = getActiveFilters();
    if (!scenarioData) return;
    const allMarkers = scenarioData.markers || [];
    const filteredMarkers = allMarkers.filter(m => activeTypes.includes(m.type));
    if (clusterer) clusterer.removeAll();
    addedMarkerIds.clear();
    allPlacemarks = [];
    filteredMarkers.forEach(marker => {
        const placemark = createYandexPlacemark(marker);
        clusterer.add(placemark);
        addedMarkerIds.add(marker.id);
        allPlacemarks.push(placemark);
    });
    const filteredIncidents = {};
    filteredMarkers.forEach(m => { filteredIncidents[m.type] = (filteredIncidents[m.type] || 0) + 1; });
    updateIncidentTable(filteredIncidents);
    document.getElementById('totalCalls').textContent = filteredMarkers.length;
}

function toggleCluster() {
    clusterEnabled = !clusterEnabled;
    const btn = document.getElementById('clusterToggle');
    btn.classList.toggle('active');
    const allMarkers = scenarioData?.markers || [];
    const activeTypes = getActiveFilters();
    const filteredMarkers = allMarkers.filter(m => activeTypes.includes(m.type));
    if (clusterEnabled) {
        btn.innerHTML = '<i class="fas fa-layer-group"></i> Кластеры';
        btn.style.borderColor = '#60a5fa';
        if (clusterer) map.geoObjects.remove(clusterer);
        clusterer = new ymaps.Clusterer({
            gridSize: 64,
            clusterIconLayout: 'default#pieChart',
            clusterIconColors: ['#22c55e', '#eab308', '#f97316', '#ef4444'],
            clusterIconPieValues: [10, 20, 50],
            clusterIconPieRadius: 20
        });
        map.geoObjects.add(clusterer);
        addedMarkerIds.clear();
        filteredMarkers.forEach(m => {
            const placemark = createYandexPlacemark(m);
            clusterer.add(placemark);
            addedMarkerIds.add(m.id);
            allPlacemarks.push(placemark);
        });
    } else {
        btn.innerHTML = '<i class="fas fa-th"></i> Точки';
        btn.style.borderColor = '#2a3a4a';
        if (clusterer) map.geoObjects.remove(clusterer);
        const collection = new ymaps.GeoObjectCollection();
        addedMarkerIds.clear();
        filteredMarkers.forEach(m => {
            const placemark = createYandexPlacemark(m);
            collection.add(placemark);
            addedMarkerIds.add(m.id);
        });
        map.geoObjects.add(collection);
        map.currentCollection = collection;
    }
}

function toggleMapFullscreen() {
    mapFullscreen = !mapFullscreen;
    const mapElement = document.getElementById('map');
    const btn = document.querySelector('[onclick="toggleMapFullscreen()"]');
    if (mapFullscreen) {
        mapElement.classList.add('fullscreen');
        btn.innerHTML = '<i class="fas fa-compress"></i> Свернуть';
        setTimeout(() => { if (map) map.container.fitToViewport(); }, 400);
    } else {
        mapElement.classList.remove('fullscreen');
        btn.innerHTML = '<i class="fas fa-expand"></i> Развернуть';
        setTimeout(() => { if (map) map.container.fitToViewport(); }, 400);
    }
}

// ============================================================
// 6. КАЛЕНДАРЬ
// ============================================================

function toggleCalendar() {
    const popup = document.getElementById('calendarPopup');
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    if (popup.style.display === 'block') renderCalendar();
}

function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    document.getElementById('calendarYearDisplay').textContent = year;
    document.getElementById('calendarMonthDisplay').textContent = 
        new Date(year, month).toLocaleString('ru-RU', { month: 'long' });
    document.getElementById('calendarMonthYear').textContent = 
        new Date(year, month).toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysContainer = document.getElementById('calendarDays');
    const availableSet = new Set(availableDates);
    const dateSelect = document.getElementById('dateSelect');
    daysContainer.innerHTML = '';
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center; padding:6px; color:#64748b;';
        daysContainer.appendChild(empty);
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const isAvailable = availableSet.has(dateStr);
        const isToday = dateStr === new Date().toISOString().split('T')[0];
        const isSelected = dateStr === dateSelect?.value;
        const cell = document.createElement('div');
        cell.textContent = day;
        cell.style.cssText = `
            text-align: center; padding: 6px; border-radius: 6px;
            cursor: ${isAvailable ? 'pointer' : 'default'};
            color: ${isAvailable ? '#e0e0e0' : '#64748b'};
            background: ${isSelected ? '#1a3a5a' : isToday ? '#1a2a3a' : 'transparent'};
            border: ${isToday ? '1px solid #60a5fa' : 'none'};
            transition: all 0.2s ease;
        `;
        if (isAvailable) {
            cell.onclick = () => selectDate(dateStr);
            cell.onmouseover = () => { cell.style.background = '#1a2a3a'; };
            cell.onmouseout = () => { cell.style.background = isSelected ? '#1a3a5a' : isToday ? '#1a2a3a' : 'transparent'; };
        }
        daysContainer.appendChild(cell);
    }
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    renderCalendar();
}

function changeYear(delta) {
    calendarDate.setFullYear(calendarDate.getFullYear() + delta);
    renderCalendar();
}

function selectDate(dateStr) {
    const dateSelect = document.getElementById('dateSelect');
    if (dateSelect) {
        const options = Array.from(dateSelect.options);
        const option = options.find(opt => opt.value === dateStr);
        if (option) {
            dateSelect.value = dateStr;
        } else {
            const newOption = document.createElement('option');
            newOption.value = dateStr;
            newOption.textContent = formatDate(dateStr);
            dateSelect.appendChild(newOption);
            dateSelect.value = dateStr;
        }
    }
    document.getElementById('calendarPopup').style.display = 'none';
    document.getElementById('selectedDateDisplay').textContent = formatDate(dateStr);
    currentDate = dateStr;
    loadScenarioByCity(0);
}

function changeDay(delta) {
    const dateSelect = document.getElementById('dateSelect');
    if (!dateSelect) return;
    const options = Array.from(dateSelect.options);
    const currentIndex = options.findIndex(opt => opt.value === dateSelect.value);
    if (currentIndex === -1) return;
    const newIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
    if (newIndex === currentIndex) return;
    dateSelect.selectedIndex = newIndex;
    const newDate = dateSelect.value;
    document.getElementById('selectedDateDisplay').textContent = formatDate(newDate);
    currentDate = newDate;
    loadScenarioByCity(0);
}

// ============================================================
// 7. ИНИЦИАЛИЗАЦИЯ
// ============================================================

async function initializeDashboard() {
    try {
        const cities = await loadAvailableCities();
        const firstCity = cities.length > 0 ? cities[0] : DEFAULT_CITY;
        await loadAvailableDates(firstCity);
        await loadScenarioByCity(0);
    } catch (error) {
        console.error('Ошибка инициализации:', error);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    initYandexMap();
});

document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'citySelect') {
        const city = e.target.value;
        loadAvailableDates(city).then(() => loadScenarioByCity(0));
    }
});