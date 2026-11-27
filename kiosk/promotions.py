"""Scheduled base-price discounts; the shared SQLite views own the clock."""
import json
import re
from datetime import date
from .store import Problem, integer, identifier


def promotion_state(db):
    row = db.execute('SELECT items,revision FROM promotion_catalog WHERE id=1').fetchone()
    return dict(items=json.loads(row['items']) if row else [], revision=row['revision'] if row else 0,
                active=[dict(r) for r in db.execute('SELECT id,ends_at FROM active_promotions')],
                server_time=db.execute("SELECT unixepoch('now')*1000").fetchone()[0])


def save_promotions(db, data):
    revision = integer(data.get('revision'), 0, 2**31-1, '할인 버전')
    items = data.get('items')
    if not isinstance(items, list) or len(items)>30: raise Problem('할인은 최대 30개까지 등록할 수 있습니다.')
    menus = dict(db.execute('SELECT id,base_price FROM menu'))
    def day(value):
        if value is None or value=='': return None
        try:
            if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): raise ValueError()
            date.fromisoformat(value)
        except (ValueError, TypeError): raise Problem('날짜를 확인해 주세요.')
        return value
    cleaned=[]
    for p in items:
        if not isinstance(p,dict): raise Problem('할인 정보를 확인해 주세요.')
        pid=identifier(p.get('id')); title=p.get('title'); enabled=p.get('enabled')
        if not isinstance(title,str) or not 1<=len(title.strip())<=40 or type(enabled) is not bool: raise Problem('할인 이름과 사용 여부를 확인해 주세요.')
        ids=p.get('menu_ids'); days=p.get('weekdays')
        if not isinstance(ids,list) or not 1<=len(ids)<=100 or any(type(i) is not int or i not in menus for i in ids) or len(set(ids))!=len(ids): raise Problem('할인할 메뉴를 선택해 주세요.')
        if not isinstance(days,list) or not 1<=len(days)<=7 or any(type(d) is not int or not 0<=d<=6 for d in days) or len(set(days))!=len(days): raise Problem('할인 요일을 선택해 주세요.')
        start=p.get('start_time'); end=p.get('end_time')
        valid=lambda v:isinstance(v,str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',v)
        if not valid(start) or not (valid(end) or end=='24:00') or start==end: raise Problem('시작·종료 시간을 다르게 입력해 주세요. 하루 전체는 00:00~24:00입니다.')
        mode=p.get('mode')
        if mode not in ('PERCENT','FIXED'): raise Problem('할인 방식을 선택해 주세요.')
        value=integer(p.get('value'),1,99 if mode=='PERCENT' else 1000000,'할인율/판매가')
        if mode=='FIXED' and any(value>=menus[i] for i in ids): raise Problem('할인 판매가는 선택한 모든 메뉴의 정상가보다 낮아야 합니다.')
        start_date=day(p.get('start_date')); end_date=day(p.get('end_date'))
        if start_date and end_date and start_date>end_date: raise Problem('종료 날짜는 시작 날짜보다 빠를 수 없습니다.')
        cleaned.append(dict(id=pid,title=title.strip(),enabled=enabled,menu_ids=ids,weekdays=days,start_time=start,end_time=end,start_date=start_date,end_date=end_date,mode=mode,value=value))
    if len({p['id'] for p in cleaned})!=len(cleaned): raise Problem('같은 할인이 중복되었습니다.')
    db.execute('INSERT OR IGNORE INTO promotion_catalog(id) VALUES(1)')
    result=db.execute('UPDATE promotion_catalog SET items=?,revision=revision+1 WHERE id=1 AND revision=?',(json.dumps(cleaned,ensure_ascii=False),revision))
    if result.rowcount!=1: raise Problem('할인이 변경되었습니다. 최신 목록에서 다시 수정해 주세요.',409,'PROMOTIONS_CHANGED')
    return promotion_state(db)


def priced_menu(menu, quote):
    return dict(menu, original_price=quote['original_price'], base_price=quote['sale_price'],
                promotion=dict(json.loads(quote['promotion']),ends_at=quote['ends_at']) if quote['promotion'] else None)


def check_promotion_price(db, order_id):
    changed=db.execute("""SELECT 1 FROM order_item i JOIN menu_pricing q ON q.id=i.menu_id
        WHERE i.order_id=? AND (i.promotion IS NOT NULL OR q.promotion IS NOT NULL)
        AND (coalesce(i.regular_price,i.item_price)!=q.original_price OR i.item_price!=q.sale_price
          OR coalesce(json_extract(i.promotion,'$.id'),'')!=coalesce(q.promotion_id,'')) LIMIT 1""",(order_id,)).fetchone()
    if changed: raise Problem('할인 시간이 지났거나 가격이 변경되었습니다. 새 금액을 확인해 주세요.',409,'CART_CHANGED')
