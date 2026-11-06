const MAX_DEPTH=3, MAX_GROUPS=12, MAX_CHOICES=48;
function validateGroups(groups, extraNames=[]) {
  const ids=new Set();
  let groupCount=0, choiceCount=0;
  function requireValue(condition,message) {if(!condition)throw new Error(message);}
  function node(value) {
    requireValue(value && typeof value==="object" && typeof value.id==="string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.id) && !ids.has(value.id),"선택 그룹과 선택지 식별자를 확인해 주세요.");
    ids.add(value.id);
    requireValue(typeof value.name==="string" && value.name.trim() && [...value.name.trim()].length<=40,"그룹명과 선택지 이름은 1~40자로 입력해 주세요.");
    return {id:value.id,name:value.name.trim()};
  }
  function walk(list,depth) {
    requireValue(Array.isArray(list) && (!list.length || depth<=MAX_DEPTH),"선택 그룹은 3단계까지 설정할 수 있습니다.");
    const groupNames=new Set();
    return list.map(group=>{
      const head=node(group);
      const trigger=group.when_extra??null;
      requireValue(trigger===null || (depth===1 && extraNames.includes(trigger)),"하위 그룹이 연결된 추가 옵션을 확인해 주세요.");
      const scope=JSON.stringify([trigger,head.name]);
      requireValue(!groupNames.has(scope),"같은 위치의 그룹명은 서로 다르게 입력해 주세요.");
      groupNames.add(scope);
      requireValue(++groupCount<=MAX_GROUPS && typeof group.required==="boolean","선택 그룹은 메뉴당 12개까지 설정할 수 있습니다.");
      requireValue(Array.isArray(group.choices) && group.choices.length>=1,"그룹마다 선택지를 하나 이상 입력해 주세요.");
      const names=new Set();
      const choices=group.choices.map(choice=>{
        const label=node(choice);
        requireValue(!names.has(label.name),"같은 그룹에 동일한 선택지를 두 번 넣을 수 없습니다.");
        names.add(label.name);
        requireValue(++choiceCount<=MAX_CHOICES,"선택지는 메뉴당 48개까지 설정할 수 있습니다.");
        requireValue(Number.isInteger(choice.extra_price) && choice.extra_price>=0 && choice.extra_price<=1000000,"선택지의 추가 금액을 확인해 주세요.");
        return {...label,extra_price:choice.extra_price,children:walk(choice.children??[],depth+1)};
      });
      return {...head,required:group.required,choices,...(trigger?{when_extra:trigger}:{})};
    });
  }
  return walk(groups,1);
}
function evaluateGroups(groups, selected, extraNames=[]) {
  const validList=Array.isArray(selected)&&selected.every(id=>typeof id==="string")&&selected.length<=MAX_GROUPS;
  const wanted=new Set(validList?selected:[]);
  const ids=[], snapshot=[], missing=[];
  let conflict=false;
  function visit(list) {
    for(const group of list) {
      const matches=group.choices.filter(c=>wanted.has(c.id));
      if(matches.length>1)conflict=true;
      if(!matches.length){if(group.required)missing.push(group.name);continue;}
      const choice=matches[0];
      ids.push(choice.id);
      snapshot.push({name:group.name+" · "+choice.name,option_price:choice.extra_price});
      visit(choice.children);
    }
  }
  visit(groups.filter(g=>!g.when_extra || extraNames.includes(g.when_extra)));
  const invalid=!validList || conflict || ids.length!==selected.length;
  return {ids,snapshot,missing,invalid,amount:snapshot.reduce((n,o)=>n+o.option_price,0)};
}

export {validateGroups, evaluateGroups, MAX_DEPTH, MAX_GROUPS, MAX_CHOICES};
