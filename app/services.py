from app import db
from app.models import Call, Service, Threshold, UploadedFile
from datetime import datetime, timedelta
from sqlalchemy import func, distinct
import json

class EmergencyService:
    
    @staticmethod
    def get_calls_by_date_range(start_date, end_date):
        """Получить вызовы за указанный период"""
        calls = Call.query.filter(
            Call.created_at >= start_date,
            Call.created_at < end_date
        ).order_by(Call.created_at.asc()).all()
        
        return [c.to_dict() for c in calls]
    
    @staticmethod
    def get_calls_by_timestamp(timestamp):
        """Получить вызовы, произошедшие до указанного момента"""
        calls = Call.query.filter(
            Call.created_at <= timestamp
        ).order_by(Call.created_at.asc()).all()
        
        return [c.to_dict() for c in calls]
    
    @staticmethod
    def get_load_factor_for_scenario(start_date, max_date):
        """Рассчитывает коэффициент нагрузки для сценария с таймлайном"""
        # Все вызовы до max_date
        calls = Call.query.filter(
            Call.created_at >= start_date,
            Call.created_at <= max_date
        ).all()
        
        # Группируем по часам
        hourly_counts = {}
        for call in calls:
            hour_key = call.created_at.strftime('%Y-%m-%d %H:00:00')
            hourly_counts[hour_key] = hourly_counts.get(hour_key, 0) + 1
        
        # Сортируем по времени
        sorted_keys = sorted(hourly_counts.keys())
        counts = [hourly_counts[k] for k in sorted_keys]
        
        # Среднее значение за период
        avg_count = sum(counts) / len(counts) if counts else 1
        
        # Коэффициент нагрузки
        load_factors = [round(count / avg_count, 2) if avg_count > 0 else 1.0 for count in counts]
        
        return {
            'timestamps': sorted_keys,
            'counts': counts,
            'load_factors': load_factors,
            'current_load': load_factors[-1] if load_factors else 1.0
        }
    
    @staticmethod
    def get_markers_for_map(timestamp):
        """Получить маркеры для карты на конкретный момент времени"""
        calls = Call.query.filter(
            Call.created_at <= timestamp
        ).order_by(Call.created_at.asc()).all()
        
        markers = []
        for call in calls:
            markers.append({
                'id': call.id,
                'lat': call.latitude,
                'lng': call.longitude,
                'type': call.incident_type,
                'description': call.description,
                'created_at': call.created_at.isoformat() if call.created_at else None,
                'color': call.get_color(),
                'icon': call.get_icon(),
                'services': [s.code for s in call.services]
            })
        
        return markers
    
    @staticmethod
    def get_scenario_data(start_date, current_time):
        """Получить все данные для сценария"""
        # Данные для графика
        load_data = EmergencyService.get_load_factor_for_scenario(start_date, current_time)
        
        # Данные для карты
        markers = EmergencyService.get_markers_for_map(current_time)
        
        # Статистика по типам
        calls = Call.query.filter(
            Call.created_at >= start_date,
            Call.created_at <= current_time
        ).all()
        
        incidents = {}
        for call in calls:
            incidents[call.incident_type] = incidents.get(call.incident_type, 0) + 1
        
        # Формируем результат
        result = {
            'load_factors': load_data['load_factors'],
            'timestamps': load_data['timestamps'],
            'current_load': load_data['current_load'],
            'markers': markers,
            'total_calls': len(calls),
            'incidents': incidents,
            'current_time': current_time.isoformat() if current_time else None
        }
        
        return result
    
    @staticmethod
    def get_available_cities():
        """Получить список городов, для которых есть данные"""
        cities = db.session.query(distinct(Call.address)).all()
        # Извлекаем город из адреса (например, "г. Оренбург" → "Оренбург")
        result = []
        for (addr,) in cities:
            if addr and 'г.' in addr:
                city = addr.split('г.')[1].strip().split(',')[0].strip()
                if city and city not in result:
                    result.append(city)
        return result or ['Оренбург', 'Орск']
    
    @staticmethod
    def get_available_dates(city=None):
        """Получить список доступных дат для выбранного города"""
        query = db.session.query(distinct(func.date(Call.created_at)))
        if city:
            query = query.filter(Call.address.like(f'%{city}%'))
        dates = query.order_by(func.date(Call.created_at).asc()).all()
        return [d[0].isoformat() for d in dates if d[0]]
    
    @staticmethod
    def get_calls_for_city_date(city, date_str):
        """Получить вызовы для конкретного города и даты"""
        target_date = datetime.strptime(date_str, '%Y-%m-%d')
        start_date = target_date.replace(hour=0, minute=0, second=0)
        end_date = target_date.replace(hour=23, minute=59, second=59)
        
        query = Call.query.filter(
            Call.created_at >= start_date,
            Call.created_at <= end_date
        )
        if city:
            query = query.filter(Call.address.like(f'%{city}%'))
        
        return query.order_by(Call.created_at.asc()).all()
    
    @staticmethod
    def get_scenario_data_for_city_date(city, date_str, current_time=None, time_range_hours=24):
        """Получить данные для сценария с учётом временного диапазона"""
        target_date = datetime.strptime(date_str, '%Y-%m-%d')
        start_date = target_date.replace(hour=0, minute=0, second=0)
        
        if current_time:
            end_date = datetime.fromisoformat(current_time)
        else:
            end_date = target_date.replace(hour=23, minute=59, second=59)
        
        # ✅ РАССЧИТЫВАЕМ НАЧАЛО С УЧЁТОМ ДЛИТЕЛЬНОСТИ
        if time_range_hours > 0:
            range_start = end_date - timedelta(hours=time_range_hours)
        else:
            range_start = start_date  # ♾️ Все вызовы
        
        # Получаем вызовы за период
        calls = Call.query.filter(
            Call.created_at >= range_start,
            Call.created_at <= end_date
        )
        if city:
            calls = calls.filter(Call.address.like(f'%{city}%'))
        calls = calls.order_by(Call.created_at.asc()).all()
        
        # Группируем по часам
        hourly_counts = {}
        for call in calls:
            hour_key = call.created_at.strftime('%Y-%m-%d %H:00:00')
            hourly_counts[hour_key] = hourly_counts.get(hour_key, 0) + 1
        
        sorted_keys = sorted(hourly_counts.keys())
        counts = [hourly_counts[k] for k in sorted_keys]
        avg_count = sum(counts) / len(counts) if counts else 1
        load_factors = [round(count / avg_count, 2) if avg_count > 0 else 1.0 for count in counts]
        
        # Статистика по типам
        incidents = {}
        for call in calls:
            incidents[call.incident_type] = incidents.get(call.incident_type, 0) + 1
        
        # Маркеры для карты
        markers = []
        for call in calls:
            markers.append({
                'id': call.id,
                'lat': call.latitude,
                'lng': call.longitude,
                'type': call.incident_type,
                'description': call.description,
                'created_at': call.created_at.isoformat() if call.created_at else None,
                'color': call.get_color(),
                'icon': call.get_icon(),
                'services': [s.code for s in call.services]
            })
        
        return {
            'load_factors': load_factors,
            'timestamps': sorted_keys,
            'current_load': load_factors[-1] if load_factors else 1.0,
            'markers': markers,
            'total_calls': len(calls),
            'incidents': incidents,
            'current_time': end_date.isoformat() if end_date else None,
            'city': city,
            'date': date_str
        }


# ============================================================
# ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ ПОРОГОВЫХ ЗНАЧЕНИЙ
# ============================================================

def init_thresholds():
    """Создает пороговые значения, если их нет"""
    from app.models import Threshold
    
    if Threshold.query.count() == 0:
        defaults = [
            {'threshold_type': 'normal', 'min_value': 0, 'max_value': 1.2, 
             'description': 'Штатный режим', 'color_code': '#22c55e'},
            {'threshold_type': 'warning', 'min_value': 1.2, 'max_value': 1.5, 
             'description': 'Повышенная нагрузка', 'color_code': '#eab308'},
            {'threshold_type': 'danger', 'min_value': 1.5, 'max_value': 3.0, 
             'description': 'Превышение порога', 'color_code': '#f97316'},
            {'threshold_type': 'critical', 'min_value': 3.0, 'max_value': 999.0, 
             'description': 'Критическая ситуация', 'color_code': '#ef4444'}
        ]
        
        for t in defaults:
            threshold = Threshold(**t)
            db.session.add(threshold)
        
        db.session.commit()
        print("✅ Пороговые значения созданы")
    else:
        print("ℹ️ Пороговые значения уже существуют")

# Добавьте в app/services.py новый метод:

def get_scenario_data_filtered(self, start_date, current_time, services_filter):
    """Получить данные с фильтрацией по службам"""
    from app.models import Call, Service
    
    # Базовый запрос
    query = Call.query.filter(
        Call.created_at >= start_date,
        Call.created_at <= current_time
    )
    
    # Фильтр по службам
    if services_filter:
        service_codes = services_filter.split(',')
        # Ищем вызовы, у которых есть хотя бы одна из указанных служб
        query = query.filter(Call.services.any(Service.code.in_(service_codes)))
    
    calls = query.all()
    
    # Группируем по часам
    hourly_counts = {}
    for call in calls:
        hour_key = call.created_at.strftime('%Y-%m-%d %H:00:00')
        hourly_counts[hour_key] = hourly_counts.get(hour_key, 0) + 1
    
    sorted_keys = sorted(hourly_counts.keys())
    counts = [hourly_counts[k] for k in sorted_keys]
    
    avg_count = sum(counts) / len(counts) if counts else 1
    load_factors = [round(count / avg_count, 2) if avg_count > 0 else 1.0 for count in counts]
    
    # Статистика по типам
    incidents = {}
    for call in calls:
        incidents[call.incident_type] = incidents.get(call.incident_type, 0) + 1
    
    # Маркеры для карты
    markers = []
    for call in calls:
        markers.append({
            'id': call.id,
            'lat': call.latitude,
            'lng': call.longitude,
            'type': call.incident_type,
            'description': call.description,
            'created_at': call.created_at.isoformat() if call.created_at else None,
            'color': call.get_color(),
            'icon': call.get_icon(),
            'services': [s.code for s in call.services]
        })
    
    return {
        'load_factors': load_factors,
        'timestamps': sorted_keys,
        'current_load': load_factors[-1] if load_factors else 1.0,
        'markers': markers,
        'total_calls': len(calls),
        'incidents': incidents,
        'current_time': current_time.isoformat() if current_time else None
    }