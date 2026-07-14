from flask import Blueprint, render_template, jsonify, request, current_app
from app import db
from app.services import EmergencyService
from app.excel_importer import process_excel_import_async, clear_database, get_import_status, generate_import_id
from datetime import datetime, timedelta
import os
import json
import threading

api_bp = Blueprint('api', __name__)

# ============================================================
# СТРАНИЦЫ
# ============================================================

@api_bp.route('/')
def index():
    return render_template('index.html')

@api_bp.route('/admin')
def admin():
    return render_template('admin.html')

# ============================================================
# API ДЛЯ СЦЕНАРИЯ
# ============================================================

@api_bp.route('/api/scenario')
def get_scenario():
    start_date = request.args.get('start_date', '2022-02-17')
    current_time = request.args.get('current_time')
    
    start_dt = datetime.strptime(start_date, '%Y-%m-%d')
    
    if current_time:
        current_dt = datetime.fromisoformat(current_time)
    else:
        current_dt = start_dt + timedelta(days=1)
    
    data = EmergencyService.get_scenario_data(start_dt, current_dt)
    return jsonify(data)

# ============================================================
# API ДЛЯ ИМПОРТА
# ============================================================

@api_bp.route('/api/upload', methods=['POST'])
def upload_excel():
    """Загрузка и асинхронная обработка Excel-файла"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Empty filename'}), 400
        
        if not file.filename.endswith(('.xlsx', '.xls')):
            return jsonify({'error': 'Only Excel files (.xlsx, .xls) are allowed'}), 400
        
        # Сохраняем файл
        upload_folder = os.path.join(os.path.dirname(__file__), '..', 'uploads')
        os.makedirs(upload_folder, exist_ok=True)
        
        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
        filepath = os.path.join(upload_folder, filename)
        file.save(filepath)
        
        # Определяем город
        city = 'Оренбург'
        if 'оренбург' in file.filename.lower():
            city = 'Оренбург'
        elif 'орск' in file.filename.lower():
            city = 'Орск'
        
        # Генерируем ID для отслеживания
        import_id = generate_import_id()
        
        # ✅ ПОЛУЧАЕМ КОНТЕКСТ ПРИЛОЖЕНИЯ
        app = current_app._get_current_object()
        
        # Запускаем импорт в фоновом потоке С КОНТЕКСТОМ
        def run_import():
            with app.app_context():
                process_excel_import_async(filepath, city, import_id)
        
        thread = threading.Thread(target=run_import)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'import_id': import_id,
            'message': 'Импорт запущен в фоновом режиме'
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@api_bp.route('/api/upload_status/<import_id>')
def get_upload_status(import_id):
    """Получить статус импорта"""
    try:
        status = get_import_status(import_id)
        return jsonify(status)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@api_bp.route('/api/clear_db', methods=['POST'])
def clear_db():
    try:
        result = clear_database()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@api_bp.route('/api/uploads')
def get_uploads():
    try:
        from app.models import UploadedFile
        uploads = UploadedFile.query.order_by(UploadedFile.uploaded_at.desc()).limit(50).all()
        return jsonify([{
            'id': u.id,
            'filename': u.filename,
            'rows_imported': u.rows_imported,
            'status': u.status,
            'city': u.city,
            'uploaded_at': u.uploaded_at.isoformat() if u.uploaded_at else None
        } for u in uploads])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/api/health')
def health_check():
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

@api_bp.route('/api/services')
def get_services():
    try:
        from app.models import Service
        services = Service.query.all()
        return jsonify([s.to_dict() for s in services])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@api_bp.route('/api/cities')
def get_cities():
    """Получить список доступных городов"""
    cities = EmergencyService.get_available_cities()
    return jsonify(cities)

@api_bp.route('/api/dates')
def get_dates():
    """Получить список доступных дат для города"""
    city = request.args.get('city', 'Оренбург')
    dates = EmergencyService.get_available_dates(city)
    return jsonify(dates)

@api_bp.route('/api/scenario_by_city')
def get_scenario_by_city():
    city = request.args.get('city', 'Оренбург')
    date_str = request.args.get('date')
    current_time = request.args.get('current_time')
    time_range = request.args.get('time_range', 24, type=int)
    
    if not date_str:
        dates = EmergencyService.get_available_dates(city)
        if dates:
            date_str = dates[-1]
        else:
            date_str = '2024-03-01'
    
    data = EmergencyService.get_scenario_data_for_city_date(
        city, date_str, current_time, time_range
    )
    return jsonify(data)