// ============================================================
// dashboard.js — ПОЛНАЯ ВЕРСИЯ
// ============================================================

// 1. СОСТОЯНИЕ
// ============================================================

const state = {
    city: 'Оренбург',
    date: '',
    startHour: 0,
    displayHours: 24,
    currentTime: null,
    chart: null,
    map: null,
    clusterer: null,
    mapInitialized: false,
    addedMarkerIds: new Set(),
    isPlaying: false,
    playInterval: null,
    speed: 1,
    isEndOfDay: false,
    availableDates: [],
    
    // Параметры графика
    targetMean: 10.0,
    confidenceInterval: 2.5,
    upperEscalation: 20.0,
    lowerEscalation: 2.0,
    
    // Данные графика
    rawCounts: [],
    loadFactors: [],
    timestamps: [],
    chartLines: {},
    markers: [],
    
    isInitialized: false
};

// ============================================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function getDisplayHours() {
    const select = document.getElementById('displayHoursSelect');
    return parseInt(select?.value || 24);
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
    });
}

function getCityCenter(city) {
    return city === 'Орск' ? [51.2045, 58.5669] : [51.7682, 55.0970];
}

// ============================================================
// 3. ЗАГРУЗКА ГОРОДОВ И ДАТ
// ============================================================

async function loadCities() {
    try {
        const response = await fetch('/api/cities');
        const cities = await response.json();
        const select = document.getElementById('citySelect');
        if (!select) return cities;
        
        select.innerHTML = '';
        cities.forEach(city => {
            const opt = document.createElement('option');
            opt.value = city;
            opt.textContent = city;
            select.appendChild(opt);
        });
        return cities;
    } catch (error) {
        console.error('Ошибка загрузки городов:', error);
        return ['Оренбург'];
    }
}

async function loadDates(city) {
    try {
        const response = await fetch(`/api/dates?city=${encodeURIComponent(city)}`);
        const dates = await response.json();
        state.availableDates = dates || [];
        
        dates.sort((a, b) => new Date(a) - new Date(b));
        
        // Создаём скрытый select для хранения дат
        let dateSelect = document.getElementById('dateSelect');
        if (!dateSelect) {
            dateSelect = document.createElement('select');
            dateSelect.id = 'dateSelect';
            dateSelect.style.display = 'none';
            document.body.appendChild(dateSelect);
        }
        dateSelect.innerHTML = '';
        
        if (!dates || dates.length === 0) {
            dateSelect.innerHTML = '<option value="">Нет данных</option>';
            document.getElementById('selectedDateDisplay').textContent = 'Нет данных';
            return [];
        }
        
        dates.forEach(date => {
            const option = document.createElement('option');
            option.value = date;
            option.textContent = formatDate(date);
            dateSelect.appendChild(option);
        });
        
        state.date = dates[dates.length - 1];
        dateSelect.value = state.date;
        document.getElementById('selectedDateDisplay').textContent = formatDate(state.date);
        
        renderCalendar();
        return dates;
    } catch (error) {
        console.error('Ошибка загрузки дат:', error);
        return [];
    }
}

// ============================================================
// 4. ЗАГРУЗКА ДАННЫХ ДЛЯ ГРАФИКА
// ============================================================

async function loadInitialChartData() {
    const city = document.getElementById('citySelect')?.value || state.city;
    const dateStr = state.date || state.availableDates[state.availableDates.length - 1];
    const startHour = parseInt(document.getElementById('startHourSelect')?.value || 0);
    const displayHours = getDisplayHours();
    
    const targetMean = parseFloat(document.getElementById('targetMeanInput')?.value) || state.targetMean;
    const confidenceInterval = parseFloat(document.getElementById('confidenceInput')?.value) || state.confidenceInterval;
    const upperEscalation = parseFloat(document.getElementById('upperEscalationInput')?.value) || state.upperEscalation;
    const lowerEscalation = parseFloat(document.getElementById('lowerEscalationInput')?.value) || state.lowerEscalation;
    
    state.targetMean = targetMean;
    state.confidenceInterval = confidenceInterval;
    state.upperEscalation = upperEscalation;
    state.lowerEscalation = lowerEscalation;
    state.city = city;
    state.date = dateStr;
    state.startHour = startHour;
    state.displayHours = displayHours;
    
    const url = `/api/initial_chart_data?city=${encodeURIComponent(city)}&date=${dateStr}&start_hour=${startHour}&display_hours=${displayHours}&target_mean=${targetMean}&confidence_interval=${confidenceInterval}&upper_escalation=${upperEscalation}&lower_escalation=${lowerEscalation}`;
    const response = await fetch(url);
    const data = await response.json();
    
    state.currentTime = data.current_time;
    state.rawCounts = data.raw_counts;
    state.loadFactors = data.load_factors;
    state.timestamps = data.timestamps;
    state.chartLines = data.chart_lines;
    state.markers = data.markers;
    
    updateDashboard(data);
    renderChart(data);
    updateMap(data.markers);
    updateTimeline(0);
    updateCallsInfo(data.total_calls);
    
    state.isInitialized = true;
}

// ============================================================
// 5. ОБНОВЛЕНИЕ UI
// ============================================================

function updateDashboard(data) {
    const loadFactor = data.load_factors?.length > 0 ? data.load_factors[data.load_factors.length - 1] : 1.0;
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
        alertText.textContent = '🚨 КРИТИЧЕСКОЕ ПРЕВЫШЕНИЕ!';
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
        alertText.textContent = '📵 Аномальное падение вызовов.';
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
    container.innerHTML = '<span style="color:#94a3b8; font-size:12px;">Службы:</span>';
    services.forEach(s => {
        container.innerHTML += `<span><span class="dot" style="background:${colors[s] || '#60a5fa'};"></span>${names[s] || s}</span>`;
    });
}

function updateCallsInfo(total) {
    const el = document.getElementById('callsInfo');
    if (el) el.textContent = `Вызовов: ${total || 0}`;
}

function updateTimeline(progress) {
    document.getElementById('progressLabel').textContent = Math.round(progress) + '%';
    document.getElementById('timelineSlider').value = progress;
    if (state.currentTime) {
        const dt = new Date(state.currentTime);
        document.getElementById('simTimeLabel').textContent = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('currentDateDisplay').textContent = dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        document.getElementById('currentTimeDisplay').textContent = dt.toLocaleTimeString('ru-RU');
        document.getElementById('currentDateDisplay2').textContent = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
}

// ============================================================
// 6. ГРАФИК
// ============================================================

function renderChart(data) {
    const ctx = document.getElementById('loadChart').getContext('2d');
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    
    const rawCounts = data.raw_counts || [];
    const timestamps = data.timestamps || [];
    const lines = data.chart_lines || {};
    
    if (rawCounts.length === 0) {
        state.chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ data: [] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }
    
    const labels = timestamps.map(t => {
        const d = new Date(t);
        return d.getHours().toString().padStart(2, '0') + ':00';
    });
    
    const allValues = [...rawCounts, lines.upper_escalation || 0, lines.upper_confidence || 0];
    const maxVal = Math.max(5, ...allValues) + 2;
    
    const datasets = [];
    
    // Основной график
    const colors = rawCounts.map(val => {
        if (val >= (lines.upper_escalation || Infinity)) return '#ef4444';
        if (val >= (lines.upper_confidence || Infinity)) return '#f97316';
        if (val <= (lines.lower_escalation || -Infinity)) return '#f97316';
        return '#22c55e';
    });
    
    datasets.push({
        label: 'Вызовы',
        data: rawCounts,
        borderColor: '#60a5fa',
        borderWidth: 3,
        pointBackgroundColor: colors,
        pointBorderColor: colors.map(c => c === '#22c55e' ? '#15803d' : c === '#ef4444' ? '#b91c1c' : '#c2410c'),
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
        backgroundColor: 'rgba(96, 165, 250, 0.08)',
        tension: 0.3,
        fill: false
    });
    
    // Целевое среднее
    if (lines.target_mean !== undefined) {
        datasets.push({
            label: 'Целевое среднее',
            data: Array(rawCounts.length).fill(lines.target_mean),
            borderColor: '#22c55e',
            borderWidth: 2,
            borderDash: [8, 4],
            pointRadius: 0,
            fill: false
        });
    }
    
    // Верхний доверительный интервал
    if (lines.upper_confidence !== undefined) {
        datasets.push({
            label: 'Верхний доверительный интервал',
            data: Array(rawCounts.length).fill(lines.upper_confidence),
            borderColor: 'rgba(34, 197, 94, 0.3)',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false
        });
    }
    
    // Нижний доверительный интервал
    if (lines.lower_confidence !== undefined) {
        datasets.push({
            label: 'Нижний доверительный интервал',
            data: Array(rawCounts.length).fill(lines.lower_confidence),
            borderColor: 'rgba(34, 197, 94, 0.3)',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: '+1'
        });
    }
    
    // Верхняя эскалация
    if (lines.upper_escalation !== undefined) {
        datasets.push({
            label: 'Верхняя эскалация',
            data: Array(rawCounts.length).fill(lines.upper_escalation),
            borderColor: '#ef4444',
            borderWidth: 2,
            borderDash: [12, 6],
            pointRadius: 0,
            fill: false
        });
    }
    
    // Нижняя эскалация
    if (lines.lower_escalation !== undefined) {
        datasets.push({
            label: 'Нижняя эскалация',
            data: Array(rawCounts.length).fill(lines.lower_escalation),
            borderColor: '#ef4444',
            borderWidth: 2,
            borderDash: [12, 6],
            pointRadius: 0,
            fill: false
        });
    }
    
    state.chart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300, easing: 'easeOutQuart' },
            plugins: {
                legend: { 
                    labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 8 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10,15,26,0.9)',
                    titleColor: '#e0e0e0',
                    bodyColor: '#94a3b8',
                    borderColor: '#1e2a3a',
                    borderWidth: 1,
                    callbacks: {
                        afterBody: function(context) {
                            const val = context[0].parsed.y;
                            const line = state.chartLines;
                            if (val >= line.upper_escalation) return '🚨 КРИТИЧЕСКОЕ ПРЕВЫШЕНИЕ!';
                            if (val >= line.upper_confidence) return '⚠️ Превышение доверительного интервала';
                            if (val <= line.lower_escalation) return '📵 Аномальное падение';
                            return '✅ В пределах нормы';
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: maxVal,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', stepSize: Math.ceil(maxVal / 10) },
                    title: { display: true, text: 'Вызовы в час', color: '#94a3b8' }
                },
                x: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: '#94a3b8', maxTicksLimit: 12 }
                }
            }
        }
    });
}

function addPointToChart(timestamp, rawCount) {
    if (!state.chart) return;
    
    const label = new Date(timestamp).getHours().toString().padStart(2, '0') + ':00';
    const lines = state.chartLines;
    
    state.chart.data.labels.push(label);
    state.chart.data.datasets[0].data.push(rawCount);
    
    const totalPoints = state.chart.data.labels.length;
    const maxPoints = state.displayHours;
    
    if (totalPoints > maxPoints) {
        state.chart.data.labels.shift();
        state.chart.data.datasets.forEach(ds => {
            if (ds.data.length > maxPoints) {
                ds.data.shift();
            }
        });
    }
    
    const allData = state.chart.data.datasets[0].data;
    const maxVal = Math.max(5, ...allData, lines.upper_escalation || 0, lines.upper_confidence || 0) + 2;
    state.chart.options.scales.y.max = maxVal;
    state.chart.update();
}

// ============================================================
// 7. КАРТА (Яндекс.Карты)
// ============================================================

function initYandexMap() {
    if (state.mapInitialized) return;
    
    ymaps.ready(function() {
        state.map = new ymaps.Map('map', {
            center: [51.7682, 55.0970],
            zoom: 12,
            controls: ['zoomControl']
        });
        state.map.options.set('preset', 'dark');
        
        state.clusterer = new ymaps.Clusterer({
            gridSize: 64,
            clusterIconLayout: 'default#pieChart',
            clusterIconColors: ['#22c55e', '#eab308', '#f97316', '#ef4444'],
            clusterIconPieValues: [10, 20, 50],
            clusterIconPieRadius: 20
        });
        state.map.geoObjects.add(state.clusterer);
        state.mapInitialized = true;
        
        initializeDashboard();
    });
}

function createYandexPlacemark(marker) {
    const color = marker.color || '#60a5fa';
    const icon = marker.icon || '📌';
    const description = marker.description || marker.type || 'Вызов';
    
    const serviceNames = {
        'ДДС-01': 'Пожарная служба', 'ДДС-02': 'Полиция', 'ДДС-03': 'Скорая помощь',
        'ДДС-04': 'Газовая служба', 'Антитеррор': 'Антитеррор', 'ЦУКС': 'ЦУКС',
        'ЕДДС': 'ЕДДС', 'CONSULT': 'Консультация'
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
                        <div style="font-size: 11px; color: #999; margin-top: 4px;">📍 ${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}</div>
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
            balloonPanelMaxMapArea: 0,
            openBalloonOnClick: true
        }
    );
    
    placemark.events.add('click', function(e) {
        this.balloon.open();
    });
    
    return placemark;
}

function updateMap(markers) {
    if (!state.mapInitialized || !state.clusterer) return;
    state.clusterer.removeAll();
    state.addedMarkerIds.clear();
    markers.forEach(marker => {
        const placemark = createYandexPlacemark(marker);
        state.clusterer.add(placemark);
        state.addedMarkerIds.add(marker.id);
    });
    if (markers.length > 0) {
        const coords = markers.map(m => [m.lat, m.lng]);
        if (coords.length > 1) {
            state.map.setBounds(coords, { checkZoomRange: true, zoomMargin: 40 });
        }
    }
}

function addMarkersToMap(newMarkers) {
    if (!state.mapInitialized || !state.clusterer) return;
    const filtered = newMarkers.filter(m => !state.addedMarkerIds.has(m.id));
    filtered.forEach(marker => {
        const placemark = createYandexPlacemark(marker);
        state.clusterer.add(placemark);
        state.addedMarkerIds.add(marker.id);
    });
}

// ============================================================
// 8. СИМУЛЯЦИЯ
// ============================================================

async function nextHour() {
    if (state.isEndOfDay) return;
    
    const url = `/api/next_hour_data?city=${encodeURIComponent(state.city)}&current_time=${state.currentTime}&target_mean=${state.targetMean}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.is_end_of_day) {
        state.isEndOfDay = true;
        stopPlayback();
        document.getElementById('playBtn').innerHTML = '<i class="fas fa-stop"></i> Завершено';
        return;
    }
    
    state.currentTime = data.timestamp;
    state.markers = [...state.markers, ...data.new_calls];
    
    addPointToChart(data.timestamp, data.raw_count);
    addMarkersToMap(data.new_calls);
    
    updateCallsInfo(state.markers.length);
    updateTimeline(0);
}

function togglePlay() {
    if (state.isEndOfDay) {
        resetScenario();
        return;
    }
    
    state.isPlaying = !state.isPlaying;
    const btn = document.getElementById('playBtn');
    
    if (state.isPlaying) {
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
    if (state.playInterval) clearInterval(state.playInterval);
    const step = 800 / state.speed;
    state.playInterval = setInterval(() => {
        nextHour();
    }, step);
}

function stopPlayback() {
    if (state.playInterval) {
        clearInterval(state.playInterval);
        state.playInterval = null;
    }
}

function resetScenario() {
    stopPlayback();
    state.isPlaying = false;
    state.isEndOfDay = false;
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-play"></i> Воспроизвести';
    document.getElementById('playBtn').classList.remove('active');
    loadInitialChartData();
}

function speedUp() {
    const speeds = [0.5, 1, 2, 4, 8];
    let index = speeds.indexOf(state.speed);
    index = (index + 1) % speeds.length;
    state.speed = speeds[index];
    document.getElementById('speedLabel').textContent = state.speed + 'x';
    if (state.isPlaying) { stopPlayback(); startPlayback(); }
}

// ============================================================
// 9. КАЛЕНДАРЬ
// ============================================================

let calendarDate = new Date();

function toggleCalendar() {
    const popup = document.getElementById('calendarPopup');
    if (popup.style.display === 'none' || popup.style.display === '') {
        popup.style.display = 'block';
        renderCalendar();
    } else {
        popup.style.display = 'none';
    }
}

function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    document.getElementById('calendarYearDisplay').textContent = year;
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                        'Июль', 'Август', 'Сентябрь', 'Окторябрь', 'Ноябрь', 'Декабрь'];
    document.getElementById('calendarMonthDisplay').textContent = monthNames[month];
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysContainer = document.getElementById('calendarDays');
    const availableSet = new Set(state.availableDates);
    const dateSelect = document.getElementById('dateSelect');
    
    daysContainer.innerHTML = '';
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    
    for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center; padding:4px; color:#64748b;';
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
            text-align: center; padding: 6px 2px; border-radius: 6px;
            cursor: ${isAvailable ? 'pointer' : 'default'};
            color: ${isAvailable ? '#e0e0e0' : '#64748b'};
            background: ${isSelected ? '#1a3a5a' : isToday ? '#1a2a3a' : 'transparent'};
            border: ${isToday ? '1px solid #60a5fa' : '1px solid transparent'};
            font-size: 14px; transition: all 0.2s ease;
        `;
        if (isAvailable) {
            cell.onclick = () => selectDate(dateStr);
            cell.onmouseover = () => { if (!isSelected) cell.style.background = '#1a2a3a'; };
            cell.onmouseout = () => { if (!isSelected) cell.style.background = isToday ? '#1a2a3a' : 'transparent'; };
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
    state.date = dateStr;
    resetScenario();
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
    state.date = dateSelect.value;
    document.getElementById('selectedDateDisplay').textContent = formatDate(state.date);
    resetScenario();
}

// ============================================================
// 10. ФИЛЬТРЫ
// ============================================================

function getActiveFilters() {
    const checkboxes = document.querySelectorAll('.filter-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function applyFilters() {
    const activeTypes = getActiveFilters();
    if (!state.markers) return;
    const filteredMarkers = state.markers.filter(m => activeTypes.includes(m.type));
    if (state.clusterer) state.clusterer.removeAll();
    state.addedMarkerIds.clear();
    filteredMarkers.forEach(marker => {
        const placemark = createYandexPlacemark(marker);
        state.clusterer.add(placemark);
        state.addedMarkerIds.add(marker.id);
    });
    const incidents = {};
    filteredMarkers.forEach(m => { incidents[m.type] = (incidents[m.type] || 0) + 1; });
    updateIncidentTable(incidents);
    document.getElementById('totalCalls').textContent = filteredMarkers.length;
}

// ============================================================
// 11. КЛАСТЕРЫ / ТОЧКИ
// ============================================================

function toggleCluster() {
    const btn = document.getElementById('clusterToggle');
    const isCluster = btn.classList.toggle('active');
    if (!state.clusterer) return;
    
    const markers = state.markers || [];
    const activeTypes = getActiveFilters();
    const filteredMarkers = markers.filter(m => activeTypes.includes(m.type));
    
    if (isCluster) {
        btn.innerHTML = '<i class="fas fa-layer-group"></i> Кластеры';
        btn.style.borderColor = '#60a5fa';
        state.map.geoObjects.remove(state.clusterer);
        state.clusterer = new ymaps.Clusterer({
            gridSize: 64,
            clusterIconLayout: 'default#pieChart',
            clusterIconColors: ['#22c55e', '#eab308', '#f97316', '#ef4444'],
            clusterIconPieValues: [10, 20, 50],
            clusterIconPieRadius: 20
        });
        state.map.geoObjects.add(state.clusterer);
        state.addedMarkerIds.clear();
        filteredMarkers.forEach(m => {
            const placemark = createYandexPlacemark(m);
            state.clusterer.add(placemark);
            state.addedMarkerIds.add(m.id);
        });
    } else {
        btn.innerHTML = '<i class="fas fa-th"></i> Точки';
        btn.style.borderColor = '#2a3a4a';
        state.map.geoObjects.remove(state.clusterer);
        const collection = new ymaps.GeoObjectCollection();
        state.addedMarkerIds.clear();
        filteredMarkers.forEach(m => {
            const placemark = createYandexPlacemark(m);
            collection.add(placemark);
            state.addedMarkerIds.add(m.id);
        });
        state.map.geoObjects.add(collection);
        state.map.currentCollection = collection;
    }
}

function toggleMapFullscreen() {
    const mapElement = document.getElementById('map');
    const btn = document.querySelector('[onclick="toggleMapFullscreen()"]');
    const isFullscreen = mapElement.classList.toggle('fullscreen');
    btn.innerHTML = isFullscreen ? '<i class="fas fa-compress"></i> Свернуть' : '<i class="fas fa-expand"></i> Развернуть';
    setTimeout(() => { if (state.map) state.map.container.fitToViewport(); }, 400);
}

// ============================================================
// 12. ПРИМЕНЕНИЕ ПАРАМЕТРОВ
// ============================================================

function applyChartParams() {
    loadInitialChartData();
}

// ============================================================
// 13. ИНИЦИАЛИЗАЦИЯ ДАШБОРДА
// ============================================================

async function initializeDashboard() {
    try {
        console.log('🔄 Инициализация дашборда...');
        const cities = await loadCities();
        const firstCity = cities.length > 0 ? cities[0] : 'Оренбург';
        
        const citySelect = document.getElementById('citySelect');
        if (citySelect) citySelect.value = firstCity;
        state.city = firstCity;
        
        await loadDates(firstCity);
        
        if (state.availableDates.length > 0) {
            state.date = state.availableDates[state.availableDates.length - 1];
            const dateSelect = document.getElementById('dateSelect');
            if (dateSelect) dateSelect.value = state.date;
            document.getElementById('selectedDateDisplay').textContent = formatDate(state.date);
            await loadInitialChartData();
        }
        console.log('✅ Инициализация завершена');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
    }
}

// ============================================================
// 14. ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    initYandexMap();
});

document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'citySelect') {
        const city = e.target.value;
        state.city = city;
        loadDates(city).then(() => {
            if (state.availableDates.length > 0) {
                state.date = state.availableDates[state.availableDates.length - 1];
                resetScenario();
            }
        });
    }
});

// ============================================================
// 15. ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ HTML
// ============================================================

window.togglePlay = togglePlay;
window.resetScenario = resetScenario;
window.speedUp = speedUp;
window.applyChartParams = applyChartParams;
window.loadInitialChartData = loadInitialChartData;
window.toggleCalendar = toggleCalendar;
window.changeMonth = changeMonth;
window.changeYear = changeYear;
window.selectDate = selectDate;
window.changeDay = changeDay;
window.applyFilters = applyFilters;
window.toggleCluster = toggleCluster;
window.toggleMapFullscreen = toggleMapFullscreen;
window.onSliderChange = function(value) {
    // Пока просто перезагружаем данные
    loadInitialChartData();
};