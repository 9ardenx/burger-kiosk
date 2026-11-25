"""Sales by approval/cancellation event date in Korea, using order snapshots."""
import json
from datetime import date, datetime, timedelta
from .store import Problem


def date_range(start, end):
    try:
        a, b = date.fromisoformat(start), date.fromisoformat(end)
        if a.isoformat() != start or b.isoformat() != end or not 0 <= (b-a).days < 366:
            raise ValueError()
    except (ValueError, TypeError):
        raise Problem('올바른 날짜로 최대 366일의 조회 기간을 선택해 주세요.')
    return a, b


def sales_report(db, start, end):
    a, b = date_range(start, end)
    start_utc = (datetime.combine(a, datetime.min.time())-timedelta(hours=9)).isoformat(' ')
    end_utc = (datetime.combine(b+timedelta(days=1), datetime.min.time())-timedelta(hours=9)).isoformat(' ')
    def blank():
        return dict(approved=0, cancelled=0, net=0, orders=0, cancellations=0, quantity=0, returned_quantity=0)
    summary, menus = blank(), {}
    days = {(a+timedelta(days=n)).isoformat(): blank() for n in range((b-a).days+1)}
    dining = {key: blank() for key in ('DINE_IN', 'TAKEOUT', 'UNKNOWN')}
    for order in db.execute('''SELECT o.*,p.paid_at FROM orders o JOIN payment p ON p.order_id=o.id AND p.status='SUCCESS'
        WHERE (p.paid_at>=? AND p.paid_at<?) OR (o.cancelled_at>=? AND o.cancelled_at<?) ORDER BY p.paid_at,o.id''',
        (start_utc, end_utc, start_utc, end_utc)):
        items = []
        for item in db.execute('SELECT * FROM order_item WHERE order_id=?', (order['id'],)):
            extras = db.execute('SELECT coalesce(sum(option_price),0) FROM order_item_option WHERE order_item_id=?', (item['id'],)).fetchone()[0]
            extras += sum(x['option_price'] for x in json.loads(item['choice_snapshot']))
            items.append((item, item['quantity']*(item['item_price']+extras)))
        for timestamp, cancel in ((order['paid_at'], False), (order['cancelled_at'], True)):
            if not timestamp:
                continue
            day = (datetime.fromisoformat(timestamp)+timedelta(hours=9)).date().isoformat()
            if day not in days:
                continue
            buckets = [summary, days[day], dining.get(order['dining_type'], dining['UNKNOWN'])]
            for bucket in buckets:
                bucket['cancelled' if cancel else 'approved'] += order['total_amount']
                bucket['cancellations' if cancel else 'orders'] += 1
                bucket['net'] = bucket['approved']-bucket['cancelled']
            for item, revenue in items:
                menu = menus.setdefault(item['menu_id'], dict(id=item['menu_id'], name=item['name'], **blank()))
                menu['cancelled' if cancel else 'approved'] += revenue
                menu['net'] = menu['approved']-menu['cancelled']
                for bucket in buckets+[menu]:
                    bucket['returned_quantity' if cancel else 'quantity'] += item['quantity']
    return dict(**{'from': start, 'to': end}, timezone='Asia/Seoul', basis='payment-events', summary=summary,
        daily=[dict(date=key, **value) for key, value in days.items()],
        menus=sorted(menus.values(), key=lambda m: (-m['quantity'], -m['approved'], m['id'])),
        dining=[dict(type=key, **value) for key, value in dining.items()])
