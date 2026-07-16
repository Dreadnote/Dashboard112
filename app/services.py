from app import db
from app.models import Call, Threshold
from datetime import datetime, timedelta
from sqlalchemy import func, distinct
import numpy as np
import json

class EmergencyService:
    
    @staticmethod
    def get_available_cities():
        cities = db.session.query(distinct(Call.address)).all()
        result = []
        for (addr,) in cities:
            if addr and 'г.' in addr:
                city = addr.split('г.')[1].strip().split(',')[0].strip()
                if city and city not in result:
                    result.append(city)
        return result or ['Оренбург', 'Орск']
    
    @staticmethod
    def get_available_dates(city=None):
        query = db.session.query(distinct(func.date(Call.created_at)))
        if city:
            query = query.filter(Call.address.like(f'%{city}%'))
        dates = query.order_by(func.date(Call.created_at).asc()).all()
        return [d[0].isoformat() for d in dates if d[0]]
    
    @staticmethod
    def get_calls_for_range(city, start_time, end_time):
        query = Call.query.filter(
            Call.created_at >= start_time,
            Call.created_at <= end_time
        )
        if city:
            query = query.filter(Call.address.like(f'%{city}%'))
        return query.order_by(Call.created_at.asc()).all()
    
    @staticmethod
    def get_initial_chart_data(city, date_str, start_hour=0, display_hours=24, 
                                target_mean=None, confidence_interval=None, 
                                upper_escalation=None, lower_escalation=None):
        """
        Получить начальные данные для графика с пользовательскими параметрами
        
        Параметры:
        - city: город
        - date_str: дата (YYYY-MM-DD)
        - start_hour: час начала симуляции (0-23)
        - display_hours: сколько часов отображается на графике
        - target_mean: целевое среднее (если None — вычисляется автоматически)
        - confidence_interval: доверительный интервал (±)
        - upper_escalation: верхняя граница эскалации
        - lower_escalation: нижняя граница эскалации
        """
        target_date = datetime.strptime(date_str, '%Y-%m-%d')
        start_time = target_date.replace(hour=start_hour, minute=0, second=0, microsecond=0)
        
        # Данные для графика (от start_time - display_hours до start_time)
        graph_start = start_time - timedelta(hours=display_hours)
        graph_calls = EmergencyService.get_calls_for_range(city, graph_start, start_time)
        
        # Группируем вызовы по часам
        hourly_counts = {}
        for call in graph_calls:
            hour_key = call.created_at.replace(minute=0, second=0, microsecond=0)
            hourly_counts[hour_key] = hourly_counts.get(hour_key, 0) + 1
        
        # Сортируем часы и получаем значения
        sorted_hours = sorted(hourly_counts.keys())
        raw_counts = [hourly_counts[h] for h in sorted_hours]
        
        # ✅ ЕСЛИ ПОЛЬЗОВАТЕЛЬ НЕ УКАЗАЛ ПАРАМЕТРЫ — ВЫЧИСЛЯЕМ АВТОМАТИЧЕСКИ
        if target_mean is None:
            target_mean = np.mean(raw_counts) if raw_counts else 10.0
        
        if confidence_interval is None:
            confidence_interval = np.std(raw_counts) if raw_counts else 2.5
        
        if upper_escalation is None:
            upper_escalation = target_mean + 2 * confidence_interval
        
        if lower_escalation is None:
            lower_escalation = max(0, target_mean - 2 * confidence_interval)
        
        # Маркеры для карты (с учётом длительности попапов)
        history_start = start_time - timedelta(hours=24)  # По умолчанию 24 часа истории
        history_calls = EmergencyService.get_calls_for_range(city, history_start, start_time)
        
        markers = []
        for call in history_calls:
            markers.append({
                'id': call.id,
                'lat': call.latitude,
                'lng': call.longitude,
                'type': call.incident_type,
                'description': call.description,
                'address': call.address,
                'created_at': call.created_at.isoformat() if call.created_at else None,
                'color': call.get_color(),
                'icon': call.get_icon(),
                'services': [s.code for s in call.services]
            })
        
        # Статистика по типам
        incidents = {}
        for call in history_calls:
            incidents[call.incident_type] = incidents.get(call.incident_type, 0) + 1
        
        # Временные метки для графика
        timestamps = [h.isoformat() for h in sorted_hours]
        
        # ✅ РАССЧИТЫВАЕМ КОЭФФИЦИЕНТ НАГРУЗКИ (относительно целевого среднего)
        load_factors = [round(c / target_mean, 2) if target_mean > 0 else 1.0 for c in raw_counts]
        
        # ✅ ДОБАВЛЯЕМ ЛИНИИ ДЛЯ ГРАФИКА
        chart_lines = {
            'target_mean': target_mean,
            'confidence_interval': confidence_interval,
            'upper_escalation': upper_escalation,
            'lower_escalation': lower_escalation,
            'upper_confidence': target_mean + confidence_interval,
            'lower_confidence': max(0, target_mean - confidence_interval)
        }
        
        return {
            'markers': markers,
            'raw_counts': raw_counts,
            'load_factors': load_factors,
            'timestamps': timestamps,
            'chart_lines': chart_lines,
            'current_time': start_time.isoformat(),
            'total_calls': len(history_calls),
            'incidents': incidents,
            'city': city,
            'date': date_str,
            'start_hour': start_hour,
            'display_hours': display_hours
        }
    
    @staticmethod
    def get_next_hour_data(city, current_time, target_mean):
        """
        Получить данные для следующего часа симуляции
        """
        current_dt = datetime.fromisoformat(current_time)
        next_hour = current_dt + timedelta(hours=1)
        
        calls = EmergencyService.get_calls_for_range(city, current_dt, next_hour)
        count = len(calls)
        
        # Коэффициент нагрузки
        load_factor = round(count / target_mean, 2) if target_mean > 0 else 0
        
        markers = []
        for call in calls:
            markers.append({
                'id': call.id,
                'lat': call.latitude,
                'lng': call.longitude,
                'type': call.incident_type,
                'description': call.description,
                'address': call.address,
                'created_at': call.created_at.isoformat() if call.created_at else None,
                'color': call.get_color(),
                'icon': call.get_icon(),
                'services': [s.code for s in call.services]
            })
        
        end_of_day = next_hour.replace(hour=23, minute=59, second=59, microsecond=999999)
        is_end = next_hour >= end_of_day
        
        return {
            'new_calls': markers,
            'count': count,
            'load_factor': load_factor,
            'raw_count': count,
            'timestamp': next_hour.isoformat(),
            'is_end_of_day': is_end
        }
    
def init_thresholds():
    """Создаёт пороговые значения, если их нет"""
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