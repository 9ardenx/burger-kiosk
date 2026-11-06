"""Validation of conditional single-choice menu groups and immutable order selections."""
import re


def validate_groups(groups, extra_names=()):
    ids, counts = set(), [0, 0]

    def identity(node):
        if not isinstance(node, dict):
            raise ValueError("선택 그룹과 선택지를 확인해 주세요.")
        key, name = node.get("id"), node.get("name")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", key) or key in ids:
            raise ValueError("선택 그룹과 선택지 식별자를 확인해 주세요.")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
            raise ValueError("그룹명과 선택지 이름은 1~40자로 입력해 주세요.")
        ids.add(key)
        return {"id": key, "name": name.strip()}

    def walk(nodes, depth):
        if not isinstance(nodes, list) or (nodes and depth > 3):
            raise ValueError("선택 그룹은 3단계까지 설정할 수 있습니다.")
        result, names = [], set()
        for group in nodes:
            header = identity(group)
            trigger = group.get("when_extra")
            if trigger is not None and (depth != 1 or trigger not in extra_names):
                raise ValueError("하위 그룹이 연결된 추가 옵션을 확인해 주세요.")
            scope = (trigger, header["name"])
            if scope in names:
                raise ValueError("같은 위치의 그룹명을 확인해 주세요.")
            names.add(scope)
            counts[0] += 1
            choices = group.get("choices")
            if counts[0] > 12 or type(group.get("required")) is not bool or not isinstance(choices, list) or not choices:
                raise ValueError("그룹 수(최대 12개), 필수 여부와 선택지를 확인해 주세요.")
            cleaned, used = [], set()
            for choice in choices:
                label = identity(choice)
                price = choice.get("extra_price")
                counts[1] += 1
                if counts[1] > 48 or label["name"] in used or type(price) is not int or not 0 <= price <= 1_000_000:
                    raise ValueError("선택지 수(최대 48개), 이름과 금액을 확인해 주세요.")
                used.add(label["name"])
                cleaned.append({**label, "extra_price": price, "children": walk(choice.get("children", []), depth+1)})
            if trigger is not None:
                header["when_extra"] = trigger
            result.append({**header, "required": group["required"], "choices": cleaned})
        return result
    return walk(groups, 1)


def resolve_choices(groups, selected, extra_names=()):
    if not isinstance(selected, list) or len(selected) > 12 or any(not isinstance(key, str) for key in selected):
        raise ValueError("선택한 구성을 다시 확인해 주세요.")
    wanted, snapshot = set(selected), []

    def visit(nodes):
        for group in nodes:
            matches = [c for c in group["choices"] if c["id"] in wanted]
            if len(matches) > 1 or (not matches and group["required"]):
                raise ValueError(f"{group['name']}에서 한 가지를 선택해 주세요.")
            if matches:
                choice = matches[0]
                snapshot.append({"name": group["name"]+" · "+choice["name"], "option_price": choice["extra_price"]})
                visit(choice["children"])
    visit([g for g in groups if not g.get("when_extra") or g["when_extra"] in extra_names])
    if len(snapshot) != len(selected):
        raise ValueError("선택한 메뉴에 해당하는 구성만 주문할 수 있습니다.")
    return snapshot
