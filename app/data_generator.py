from datetime import datetime, timedelta
import random
from app import db
from app.models import Call, Service

# Координаты Орска (границы для генерации)
ORSK_BOUNDS = {
    'lat_min': 51.17,
    'lat_max': 51.25,
    'lng_min': 58.48,
    'lng_max': 58.65
}

# Типы происшествий
INCIDENT_TYPES = [
    {'type': 'Пожар', 'weight': 1.0, 'services': ['ДДС-01']},
    {'type': 'ДТП', 'weight': 1.5, 'services': ['ДДС-02', 'ДДС-03']},
    {'type': 'Запах газа', 'weight': 0.5, 'services': ['ДДС-04']},
    {'type': 'Затопление', 'weight': 0.7, 'services': ['ДДС-01', 'ДДС-03']},
    {'type': 'Прочее', 'weight': 0.3, 'services': ['ДДС-02']},
]

# Описания для каждого типа
DESCRIPTIONS = {
    'Пожар': [
        'Возгорание в жилом доме',
        'Пожар в частном секторе',
        'Горение мусора на свалке',
        'Возгорание автомобиля',
        'Пожар в административном здании'
    ],
    'ДТП': [
        'Столкновение двух автомобилей',
        'Наезд на пешехода',
        'Опрокидывание автомобиля',
        'Массовое ДТП',
        'ДТП с участием грузовика'
    ],
    'Запах газа': [
        'Запах газа в подъезде',
        'Запах газа в квартире',
        'Утечка газа на улице',
        'Запах газа в подвале',
        'Утечка газа на АЗС'
    ],
    'Затопление': [
        'Прорыв трубы в многоквартирном доме',
        'Затопление подвала',
        'Прорыв водопровода на улице',
        'Затопление частного дома',
        'Затопление технического этажа'
    ],
    'Прочее': [
        'Падение дерева',
        'Помощь животному',
        'Захлопнувшаяся дверь',
        'Спасение на высоте',
        'Обрушение конструкции'
    ]
}

def random_coordinate(base, delta):
    return base + (random.random() - 0.5) * delta

def generate_historical_data(target_date='2022-02-17'):
    """Генерирует исторические данные для указанной даты"""
    
    # Получаем или создаем службы
    services_map = {}
    for service_code in ['ДДС-01', 'ДДС-02', 'ДДС-03', 'ДДС-04']:
        service = Service.query.filter_by(code=service_code).first()
        if not service:
            names = {
                'ДДС-01': 'Пожарная служба',
                'ДДС-02': 'Полиция',
                'ДДС-03': 'Скорая медицинская помощь',
                'ДДС-04': 'Газовая служба'
            }
            colors = {
                'ДДС-01': '#ef4444',
                'ДДС-02': '#3b82f6',
                'ДДС-03': '#22c55e',
                'ДДС-04': '#f97316'
            }
            service = Service(
                code=service_code,
                name=names[service_code],
                color=colors[service_code],
                icon='🚨'
            )
            db.session.add(service)
        services_map[service_code] = service
    
    db.session.commit()
    
    # Генерируем вызовы
    calls = []
    start_date = datetime.strptime(target_date, '%Y-%m-%d')
    end_date = start_date + timedelta(days=1)
    
    # Базовое количество вызовов в день (~50-70)
    total_calls = random.randint(50, 70)
    
    # Генерируем вызовы в течение дня (с пиками в утренние и вечерние часы)
    for i in range(total_calls):
        # Распределяем по времени с пиками
        hour = random.choices(
            list(range(24)),
            weights=[0.5, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 1.3, 1.0, 0.8,
                    0.7, 0.8, 0.9, 1.1, 1.3, 1.8, 2.0, 1.8, 1.5, 1.2, 0.8, 0.6]
        )[0]
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        
        created_at = start_date + timedelta(hours=hour, minutes=minute, seconds=second)
        
        # Выбираем тип происшествия
        incident_data = random.choices(
            INCIDENT_TYPES,
            weights=[t['weight'] for t in INCIDENT_TYPES]
        )[0]
        
        # Координаты (кластеризация — некоторые районы более активны)
        if random.random() < 0.3:  # Кластер в центре
            lat = 51.2045 + (random.random() - 0.5) * 0.015
            lng = 58.5669 + (random.random() - 0.5) * 0.015
        else:
            lat = random.uniform(ORSK_BOUNDS['lat_min'], ORSK_BOUNDS['lat_max'])
            lng = random.uniform(ORSK_BOUNDS['lng_min'], ORSK_BOUNDS['lng_max'])
        
        # Описание
        description = random.choice(DESCRIPTIONS.get(incident_data['type'], ['Вызов']))
        
        # Создаем вызов
        call = Call(
            incident_type=incident_data['type'],
            description=description,
            latitude=lat,
            longitude=lng,
            address=f"г. Орск, р-н {random.choice(['Старый город', 'Новый город', 'Центр', 'Вокзальный', 'Северный', 'Южный'])}",
            created_at=created_at,
            status=random.choices(['new', 'processing', 'dispatched', 'closed'], weights=[0.1, 0.2, 0.3, 0.4])[0]
        )
        
        calls.append(call)
    
    # Сохраняем вызовы
    for call in calls:
        db.session.add(call)
        db.session.flush()  # Получаем ID
        
        # Добавляем службы
        for service_code in incident_data['services']:
            if service_code in services_map:
                call.services.append(services_map[service_code])
    
    db.session.commit()
    print(f"✅ Сгенерировано {len(calls)} вызовов для {target_date}")
    return len(calls)