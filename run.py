from app import create_app, db
from app.services import init_thresholds
from app.data_generator import generate_historical_data

app = create_app()

with app.app_context():
    # Создаем все таблицы
    db.create_all()
    print("✅ Таблицы созданы")
    
    # Инициализируем пороговые значения
    init_thresholds()
    
    # Генерируем исторические данные, если их нет
    from app.models import Call
    if Call.query.count() == 0:
        print("📊 Генерация исторических данных...")
        generate_historical_data('2022-02-17')
    else:
        print(f"ℹ️ В базе уже есть {Call.query.count()} вызовов")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)