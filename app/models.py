from app import db
from datetime import datetime
import uuid

# Таблица связи "многие ко многим" для вызовов и служб
call_services = db.Table('call_services',
    db.Column('call_id', db.Integer, db.ForeignKey('calls.id'), primary_key=True),
    db.Column('service_code', db.String(20), db.ForeignKey('services.code'), primary_key=True)
)

class Service(db.Model):
    """Справочник служб экстренного реагирования"""
    __tablename__ = 'services'
    
    code = db.Column(db.String(20), primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    color = db.Column(db.String(10), default='#60a5fa')
    icon = db.Column(db.String(10), default='🚨')
    category = db.Column(db.String(30), default='emergency')  # emergency, consulting, support
    
    def to_dict(self):
        return {
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'color': self.color,
            'icon': self.icon,
            'category': self.category
        }

class Call(db.Model):
    """Модель вызова"""
    __tablename__ = 'calls'
    
    id = db.Column(db.Integer, primary_key=True)
    call_uid = db.Column(db.String(36), unique=True, default=lambda: str(uuid.uuid4()))
    
    incident_type = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text)
    
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    address = db.Column(db.String(255))
    
    created_at = db.Column(db.DateTime, nullable=False)
    dispatched_at = db.Column(db.DateTime)
    closed_at = db.Column(db.DateTime)
    
    status = db.Column(db.String(30), default='new')
    
    # Связи
    services = db.relationship('Service', secondary=call_services, lazy='subquery')
    
    # Дополнительные данные
    extra_data = db.Column(db.JSON, default={})
    
    # Источник данных (для отслеживания импорта)
    source_file = db.Column(db.String(255))
    import_date = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'call_uid': self.call_uid,
            'incident_type': self.incident_type,
            'description': self.description,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'address': self.address,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'status': self.status,
            'services': [s.to_dict() for s in self.services],
            'source_file': self.source_file
        }
    
    def get_color(self):
        colors = {
            'Пожар': '#ef4444',
            'ДТП': '#eab308',
            'Запах газа': '#f97316',
            'Затопление': '#3b82f6',
            'Антитеррор': '#8b5cf6',
            'Прочее': '#60a5fa',
            'Консультация': '#8b5cf6',
            'ЦУКС': '#06b6d4',
            'ЕДДС': '#10b981'
        }
        return colors.get(self.incident_type, '#60a5fa')
    
    def get_icon(self):
        icons = {
            'Пожар': '🔥',
            'ДТП': '🚗',
            'Запах газа': '💨',
            'Затопление': '🌊',
            'Антитеррор': '🛡️',
            'Прочее': '📌',
            'Консультация': '💬',
            'ЦУКС': '📡',
            'ЕДДС': '📞'
        }
        return icons.get(self.incident_type, '📌')


class UploadedFile(db.Model):
    """История загруженных Excel-файлов"""
    __tablename__ = 'uploaded_files'
    
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    rows_imported = db.Column(db.Integer, default=0)
    status = db.Column(db.String(30), default='processed')
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
    mapping_config = db.Column(db.JSON, default={})
    city = db.Column(db.String(100), default='Оренбург')


class Threshold(db.Model):
    """Пороговые значения"""
    __tablename__ = 'thresholds'
    
    id = db.Column(db.Integer, primary_key=True)
    threshold_type = db.Column(db.String(30), nullable=False)
    min_value = db.Column(db.Float, nullable=False)
    max_value = db.Column(db.Float, nullable=False)
    description = db.Column(db.Text)
    color_code = db.Column(db.String(10))
    action_required = db.Column(db.Text)