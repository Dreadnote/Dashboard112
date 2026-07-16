from flask import Blueprint, render_template, jsonify, request
from app.services import EmergencyService
from app.excel_importer import clear_database, get_import_status
from datetime import datetime, timedelta
import os

api_bp = Blueprint('api', __name__)

@api_bp.route('/')
def index():
    return render_template('index.html')

@api_bp.route('/admin')
def admin():
    return render_template('admin.html')

@api_bp.route('/api/cities')
def get_cities():
    cities = EmergencyService.get_available_cities()
    return jsonify(cities)

@api_bp.route('/api/dates')
def get_dates():
    city = request.args.get('city', 'Оренбург')
    dates = EmergencyService.get_available_dates(city)
    return jsonify(dates)

@api_bp.route('/api/initial_chart_data')
def get_initial_chart_data():
    """Получить начальные данные для графика с пользовательскими параметрами"""
    city = request.args.get('city', 'Оренбург')
    date_str = request.args.get('date')
    start_hour = request.args.get('start_hour', 0, type=int)
    display_hours = request.args.get('display_hours', 24, type=int)
    
    # Параметры графика (опционально)
    target_mean = request.args.get('target_mean', type=float)
    confidence_interval = request.args.get('confidence_interval', type=float)
    upper_escalation = request.args.get('upper_escalation', type=float)
    lower_escalation = request.args.get('lower_escalation', type=float)
    
    if not date_str:
        dates = EmergencyService.get_available_dates(city)
        date_str = dates[-1] if dates else datetime.now().strftime('%Y-%m-%d')
    
    data = EmergencyService.get_initial_chart_data(
        city, date_str, start_hour, display_hours,
        target_mean, confidence_interval, upper_escalation, lower_escalation
    )
    return jsonify(data)

@api_bp.route('/api/next_hour_data')
def get_next_hour_data():
    city = request.args.get('city', 'Оренбург')
    current_time = request.args.get('current_time')
    target_mean = request.args.get('target_mean', 10.0, type=float)
    
    if not current_time:
        return jsonify({'error': 'current_time required'}), 400
    
    data = EmergencyService.get_next_hour_data(city, current_time, target_mean)
    return jsonify(data)

@api_bp.route('/api/clear_db', methods=['POST'])
def clear_db():
    result = clear_database()
    return jsonify(result)

@api_bp.route('/api/uploads')
def get_uploads():
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

@api_bp.route('/api/health')
def health_check():
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})