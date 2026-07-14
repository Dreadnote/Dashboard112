import pandas as pd
import random
from datetime import datetime
from app import db
from app.models import Call, UploadedFile
from sqlalchemy import text
import uuid
import os

# ============================================================
# КОНСТАНТЫ
# ============================================================

ORENBURG_BOUNDS = {
    'lat_min': 51.73,
    'lat_max': 51.80,
    'lng_min': 55.05,
    'lng_max': 55.20
}

SERVICE_MAPPING = {
    'Кол-во вызовов ДДС-01': {'incident_type': 'Пожар'},
    'Кол-во вызовов ДДС-02': {'incident_type': 'ДТП'},
    'Кол-во вызовов ДДС-03': {'incident_type': 'Прочее'},
    'Кол-во вызовов ДДС-04': {'incident_type': 'Запах газа'},
    'Кол-во вызовов Антитеррор': {'incident_type': 'Антитеррор'},
    'Кол-во вызовов ЦУКС': {'incident_type': 'ЦУКС'},
    'Кол-во вызовов ЕДДС': {'incident_type': 'ЕДДС'},
    'Консультационные вызовы': {'incident_type': 'Консультация'}
}

DESCRIPTIONS = {
    'Пожар': ['Возгорание', 'Пожар в здании', 'Горение'],
    'ДТП': ['Столкновение', 'Наезд', 'Опрокидывание'],
    'Запах газа': ['Утечка газа', 'Запах газа'],
    'Антитеррор': ['Подозрительный предмет', 'Подозрительное лицо', 'Угроза'],
    'ЦУКС': ['Координация сил', 'Управление'],
    'ЕДДС': ['Диспетчерский вызов', 'Координация'],
    'Консультация': ['Консультация', 'Справка'],
    'Прочее': ['Вызов']
}

# ============================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================

def generate_random_coordinate(bounds):
    lat = random.uniform(bounds['lat_min'], bounds['lat_max'])
    lng = random.uniform(bounds['lng_min'], bounds['lng_max'])
    return lat, lng

def get_random_time_for_date(date_str):
    base_date = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
    hour_weights = [0.5, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 1.8, 2.0, 1.8,
                    1.5, 1.2, 1.0, 0.8, 0.7, 0.8, 1.0, 1.2, 1.0, 0.8, 0.6, 0.5]
    hour = random.choices(list(range(24)), weights=hour_weights)[0]
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    return base_date.replace(hour=hour, minute=minute, second=second)

# ============================================================
# УПРАВЛЕНИЕ СТАТУСАМИ ИМПОРТА
# ============================================================

import_statuses = {}

def generate_import_id():
    return str(uuid.uuid4())[:8]

def get_import_status(import_id):
    return import_statuses.get(import_id, {
        'status': 'not_found',
        'total': 0,
        'processed': 0,
        'message': 'Импорт не найден',
        'errors': []
    })

# ============================================================
# ОСНОВНАЯ ФУНКЦИЯ ИМПОРТА (С ПАКЕТНОЙ ВСТАВКОЙ)
# ============================================================

def process_excel_import_async(filepath, city='Оренбург', import_id=None):
    if import_id is None:
        import_id = generate_import_id()
    
    print(f"🔵 [ИМПОРТ {import_id}] ФУНКЦИЯ ВЫЗВАНА")
    
    import_statuses[import_id] = {
        'status': 'processing',
        'total': 0,
        'processed': 0,
        'message': 'Инициализация...',
        'errors': []
    }
    
    try:
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 1: Проверка файла...")
        import_statuses[import_id]['message'] = 'Проверка файла...'
        
        if not os.path.exists(filepath):
            error_msg = f"Файл не найден: {filepath}"
            print(f"❌ [ИМПОРТ {import_id}] {error_msg}")
            import_statuses[import_id]['status'] = 'error'
            import_statuses[import_id]['message'] = f'❌ {error_msg}'
            return {'success': False, 'error': error_msg, 'import_id': import_id}
        
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 2: Чтение Excel-файла...")
        import_statuses[import_id]['message'] = 'Чтение файла...'
        
        df = pd.read_excel(filepath)
        total_rows = len(df)
        print(f"📊 [ИМПОРТ {import_id}] Прочитано {total_rows} строк")
        import_statuses[import_id]['message'] = f'Прочитано {total_rows} строк'
        
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 3: Проверка колонок...")
        columns = df.columns.tolist()
        print(f"📋 [ИМПОРТ {import_id}] Найдены колонки: {columns[:5]}...")
        
        # Проверяем наличие обязательных колонок
        if 'Дата' not in columns:
            error_msg = "В файле отсутствует колонка 'Дата'"
            print(f"❌ [ИМПОРТ {import_id}] {error_msg}")
            import_statuses[import_id]['status'] = 'error'
            import_statuses[import_id]['message'] = f'❌ {error_msg}'
            return {'success': False, 'error': error_msg, 'import_id': import_id}
        
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 4: Подсчёт вызовов...")
        import_statuses[import_id]['message'] = 'Подсчёт вызовов...'
        
        total_calls_to_import = 0
        row_count = 0
        
        for idx, row in df.iterrows():
            row_count += 1
            date_val = row.get('Дата')
            if pd.isna(date_val) or not isinstance(date_val, datetime):
                continue
            for col_name, info in SERVICE_MAPPING.items():
                if col_name in df.columns:
                    count = row.get(col_name, 0)
                    if not pd.isna(count) and count > 0:
                        total_calls_to_import += int(count)
            
            if row_count % 50 == 0:
                print(f"⏳ [ИМПОРТ {import_id}] Подсчёт: обработано {row_count} строк, найдено {total_calls_to_import} вызовов")
        
        print(f"✅ [ИМПОРТ {import_id}] Найдено {total_calls_to_import} вызовов")
        import_statuses[import_id]['total'] = total_calls_to_import
        import_statuses[import_id]['message'] = f'Найдено {total_calls_to_import} вызовов'
        
        if total_calls_to_import == 0:
            print(f"⚠️ [ИМПОРТ {import_id}] Нет данных для импорта")
            import_statuses[import_id]['status'] = 'completed'
            import_statuses[import_id]['message'] = 'Нет данных для импорта'
            return {'success': True, 'rows_imported': 0, 'import_id': import_id}
        
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 5: Начинаем пакетный импорт...")
        import_statuses[import_id]['message'] = f'Начинаем импорт {total_calls_to_import} вызовов...'
        
        BATCH_SIZE = 5000
        calls_batch = []
        total_imported = 0
        processed = 0
        errors = []
        
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 5.1: Запуск основного цикла...")
        
        for idx, row in df.iterrows():
            date_val = row.get('Дата')
            if pd.isna(date_val) or not isinstance(date_val, datetime):
                continue
            
            total_calls = row.get('Общее кол-во вызовов', 0)
            if total_calls == 0 or pd.isna(total_calls):
                continue
            
            for col_name, info in SERVICE_MAPPING.items():
                if col_name not in df.columns:
                    continue
                    
                count = row.get(col_name, 0)
                if pd.isna(count) or count == 0:
                    continue
                
                incident_type = info['incident_type']
                
                for _ in range(int(count)):
                    try:
                        lat, lng = generate_random_coordinate(ORENBURG_BOUNDS)
                        created_at = get_random_time_for_date(date_val.strftime('%Y-%m-%d %H:%M:%S'))
                        desc = random.choice(DESCRIPTIONS.get(incident_type, ['Вызов']))
                        
                        call = Call(
                            incident_type=incident_type,
                            description=f"{desc} (из {filepath.split('/')[-1]})",
                            latitude=lat,
                            longitude=lng,
                            address=f"г. {city}, р-н {random.choice(['Центральный', 'Северный', 'Южный', 'Восточный', 'Западный'])}",
                            created_at=created_at,
                            status=random.choices(['new', 'processing', 'dispatched', 'closed'], weights=[0.1, 0.2, 0.3, 0.4])[0],
                            source_file=filepath.split('/')[-1]
                        )
                        
                        calls_batch.append(call)
                        processed += 1
                        
                        if len(calls_batch) >= BATCH_SIZE:
                            print(f"💾 [ИМПОРТ {import_id}] Вставка пачки {len(calls_batch)} записей...")
                            db.session.add_all(calls_batch)
                            db.session.commit()
                            
                            total_imported += len(calls_batch)
                            import_statuses[import_id]['processed'] = total_imported
                            import_statuses[import_id]['message'] = f'Импортировано {total_imported} из {total_calls_to_import}'
                            
                            calls_batch = []
                            print(f"✅ [ИМПОРТ {import_id}] Прогресс: {total_imported}/{total_calls_to_import}")
                        
                    except Exception as e:
                        error_msg = f"Ошибка при импорте строки {idx}: {str(e)}"
                        errors.append(error_msg)
                        import_statuses[import_id]['errors'].append(error_msg)
                        print(f"❌ [ИМПОРТ {import_id}] {error_msg}")
        
        if calls_batch:
            print(f"💾 [ИМПОРТ {import_id}] Вставка последней пачки {len(calls_batch)} записей...")
            db.session.add_all(calls_batch)
            db.session.commit()
            total_imported += len(calls_batch)
            import_statuses[import_id]['processed'] = total_imported
            import_statuses[import_id]['message'] = f'Импортировано {total_imported} из {total_calls_to_import}'
            print(f"✅ [ИМПОРТ {import_id}] Прогресс: {total_imported}/{total_calls_to_import}")
        
        print(f"🔵 [ИМПОРТ {import_id}] ШАГ 6: Сохранение записи об импорте...")
        upload_record = UploadedFile(
            filename=filepath.split('/')[-1],
            filepath=filepath,
            rows_imported=total_imported,
            status='success' if not errors else 'partial',
            city=city
        )
        db.session.add(upload_record)
        db.session.commit()
        
        import_statuses[import_id]['status'] = 'completed'
        import_statuses[import_id]['processed'] = total_imported
        import_statuses[import_id]['message'] = f'✅ Импортировано {total_imported} вызовов'
        
        print(f"🎉 [ИМПОРТ {import_id}] Импорт завершён! Импортировано {total_imported} вызовов")
        
        return {
            'success': len(errors) == 0,
            'rows_imported': total_imported,
            'errors': errors,
            'total_rows': len(df),
            'import_id': import_id
        }
        
    except Exception as e:
        db.session.rollback()
        import traceback
        error_msg = f"КРИТИЧЕСКАЯ ОШИБКА: {str(e)}"
        print(f"💥 [ИМПОРТ {import_id}] {error_msg}")
        print(f"💥 [ИМПОРТ {import_id}] Traceback:")
        traceback.print_exc()
        
        import_statuses[import_id]['status'] = 'error'
        import_statuses[import_id]['message'] = f'❌ {error_msg}'
        return {
            'success': False,
            'error': error_msg,
            'import_id': import_id
        }

# ============================================================
# ОЧИСТКА БАЗЫ ДАННЫХ
# ============================================================

def clear_database():
    try:
        db.session.execute(text('DELETE FROM call_services'))
        db.session.execute(text('DELETE FROM calls'))
        db.session.execute(text('DELETE FROM uploaded_files'))
        db.session.commit()
        return {'success': True, 'message': 'База данных очищена'}
    except Exception as e:
        db.session.rollback()
        return {'success': False, 'error': str(e)}