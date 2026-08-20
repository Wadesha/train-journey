const {JSDOM}=require('jsdom');
const fs=require('fs');
const path=require('path');

const DIR='C:/Users/wade/OneDrive/claw/workbuddy/train-journey';
let html=fs.readFileSync(path.join(DIR,'index.html'),'utf8');
const data=fs.readFileSync(path.join(DIR,'data.js'),'utf8');
const trains=fs.readFileSync(path.join(DIR,'trains_data.js'),'utf8');
// 内联 data.js + trains_data.js（替换 script 标签）
html=html.replace('<script src="data.js"></script>','<script>'+data+'</script>');
html=html.replace('<script src="trains_data.js"></script>','<script>'+trains+'</script>');

let pass=0, fail=0;
function assert(name,cond){
  if(cond){pass++;console.log('PASS',name);}
  else{fail++;console.log('FAIL',name);}
}

const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://rail.local/',pretendToBeVisual:true});
const {window}=dom;
const {document}=window;
const ev=(e)=>window.eval(e);

setTimeout(()=>{
  try{
    /* ===== 数据完整性 ===== */
    assert('7 条线路', ev('Object.keys(RAIL.lines).length')===7);
    assert('107 座车站', ev('Object.keys(RAIL.stations).length')===107);
    assert('京沪 1318km', ev('RAIL.lines["京沪高速线"].total')===1318);
    assert('京广 2298km', ev('RAIL.lines["京广高速线"].total')===2298);
    assert('京沈 697km', ev('RAIL.lines["京沈高速线"].total')===697);
    assert('哈大 921km', ev('RAIL.lines["哈大高速线"].total')===921);
    assert('徐兰 1406km', ev('RAIL.lines["徐兰高速线"].total')===1406);
    assert('沪昆 2252km', ev('RAIL.lines["沪昆高速线"].total')===2252);
    assert('杭深 1450km', ev('RAIL.lines["杭深线"].total')===1450);
    assert('6 个换乘站', ev('Object.keys(RAIL.stations).filter(n=>RAIL.stations[n].lines.length>1).length')===6);
    assert('沈阳=哈大+京沈', ev('RAIL.stations["沈阳"].lines.join(",")')==='哈大高速线,京沈高速线');
    assert('上海虹桥=京沪+沪昆', ev('RAIL.stations["上海虹桥"].lines.join(",")')==='京沪高速线,沪昆高速线');
    assert('长沙南=京广+沪昆', ev('RAIL.stations["长沙南"].lines.join(",")')==='京广高速线,沪昆高速线');
    assert('京沪 上海虹桥 km=1318', ev('RAIL.lines["京沪高速线"].stations[18].km')===1318);
    assert('北京南 km=0', ev('RAIL.lines["京沪高速线"].stations[0].km')===0);
    assert('16 个成就', ev('ACHIEVEMENTS.length')===16);
    assert('真实车次表(>3000趟)', ev('Object.keys(RAIL.realTrains).length')>3000);
    assert('G1 真实经停含北京南上海虹桥', ev('RAIL.realTrains["G1"].stops[0]')==='北京南' && ev('RAIL.realTrains["G1"].stops.includes("上海虹桥")'));
    assert('G101 跨线车(京沈→哈大)', ev('RAIL.realTrains["G101"].stops.includes("北京朝阳")') && ev('RAIL.realTrains["G101"].stops.includes("哈尔滨西")'));

    /* ===== 开局 ===== */
    ev('newGame()');
    assert('初始金钱3000', ev('G.money')===3000);
    assert('初始里程0', ev('G.totalKm')===0);

    /* ===== 票价（大圆×1.15） ===== */
    assert('京沪全程二等座 513', ev('priceOf("北京南","上海虹桥","二等座")')===513);
    assert('京沪全程一等座 855', ev('priceOf("北京南","上海虹桥","一等座")')===855);
    assert('站间票价(北京南-济南西)173', ev('priceOf("北京南","济南西","二等座")')===173);

    /* ===== 购票 → 行程（真实车次） ===== */
    ev("buyTicket('G1','北京南','上海虹桥','二等座')");
    assert('行程已建立', ev('TRIP!==null'));
    assert('扣款 513', ev('G.money')===3000-513);
    assert('行程经停站序正确', ev('TRIP.stops[0]')==='北京南' && ev('TRIP.stops[TRIP.stops.length-1]')==='上海虹桥');
    assert('行程总里程>1100', ev('TRIP.totalKm')>1100);
    assert('行程界面显示', !document.getElementById('trip-screen').classList.contains('hidden'));
    assert('车次号显示 G1', document.getElementById('t-no').textContent==='G1');

    /* ===== 行驶推进 ===== */
    ev('if(rafId){cancelAnimationFrame(rafId);rafId=null;}'); // 停掉 rAF 循环
    ev('setSpeed(1)');
    ev('tick(10)'); // 10s * 1x * 8km/s = 80km
    assert('行驶 80km', Math.abs(ev('TRIP.curKm')-80)<2);
    ev('tick(30)'); // 再过 240km → 越过 G1 首站沧州西
    assert('已标记途经站', ev('TRIP.passed.size')>0);
    assert('当前时间推进', ev('TRIP.curMin')>ev('TRIP.depMin'));

    /* ===== 直达终点 → 结算 ===== */
    ev('skipToEnd()');
    assert('到站后行程结束', ev('TRIP===null'));
    assert('手账 1 条记录', ev('G.rides.length')===1);
    assert('记录区间正确', ev('G.rides[0].from')==='北京南' && ev('G.rides[0].to')==='上海虹桥');
    assert('记录覆盖京沪线', ev('G.rides[0].lines.includes("京沪高速线")'));
    assert('总里程>1100', ev('G.totalKm')>1100);
    assert('到访站含两端', ev('G.stationsVisited.has("北京南")') && ev('G.stationsVisited.has("上海虹桥")'));
    assert('成就1 首乘解锁', ev('G.achievements.has(1)'));
    assert('成就13 京沪全程解锁', ev('G.achievements.has(13)'));
    assert('成就2 500km解锁', ev('G.achievements.has(2)'));
    assert('成就3 2000km未解锁', !ev('G.achievements.has(3)'));
    assert('成就奖励已发放', ev('G.money')>3000-513);
    assert('已回主界面', ev('document.getElementById("trip-screen").classList.contains("hidden")'));

    /* ===== 反向行程（G2 真实车次） ===== */
    ev("buyTicket('G2','上海虹桥','北京南','商务座')");
    assert('反向行程建立', ev('TRIP!==null'));
    assert('反向经停正确', ev('TRIP.stops[0]')==='上海虹桥' && ev('TRIP.stops[TRIP.stops.length-1]')==='北京南');
    ev('setSpeed(1)');
    ev('tick(30)');
    assert('反向行驶中 curKm 上升', ev('TRIP.curKm')>0);
    ev('skipToEnd()');
    assert('反向到站结算', ev('G.rides.length')===2 && ev('G.rides[1].to')==='北京南');
    assert('全席体验进行中(商务座已坐)', ev('G.seatsTaken.has("商务座")'));

    /* ===== 中途下车（G1025 郑州东→长沙南） ===== */
    ev("buyTicket('G1025','郑州东','长沙南','一等座')");
    ev('if(rafId){cancelAnimationFrame(rafId);rafId=null;}');
    ev('setSpeed(16)');
    ev('tick(3)'); // 推进一部分
    ev('leaveTrip()');
    assert('手动下车结算', ev('G.rides.length')===3);
    assert('手账终点为最近站', ev('RAIL.realTrains["G1025"].stops.includes(G.rides[2].to) && G.rides[2].to!=="郑州东"'));
    assert('京广线已乘', ev('G.linesRidden.has("京广高速线")'));

    /* ===== 换乘站可选线路 ===== */
    assert('长沙南跨京广/沪昆', ev('linesOfStation("长沙南").join(",")')==='京广高速线,沪昆高速线');
    assert('长沙南→昆明南 真实可达', ev('reachableStations("长沙南").has("昆明南")'));

    /* ===== 夜行者 ===== */
    ev('G.nights=1;checkAchievements()');
    assert('成就11 夜行者解锁', ev('G.achievements.has(11)'));

    /* ===== 存档/读档 ===== */
    ev('G=null;newGame()'); // 全新存档
    ev('G.totalKm=777; G.rides.push({no:"G9",line:"京沪高速线",from:"北京南",to:"上海虹桥",km:1318,seat:"二等座",cost:554,date:"t",time:"12:00"}); G.achievements.add(1);G.achievements.add(2);G.achievements.add(13); saveGame()');
    const saved=JSON.parse(window.localStorage.getItem('railJourneySave_v1'));
    assert('localStorage 有存档', !!saved);
    assert('存档总里程777', saved.totalKm===777);
    ev('G=null'); // 模拟刷新页面（不清 localStorage）
    assert('读档成功', ev('loadGame()')===true);
    assert('读档恢复总里程777', ev('G.totalKm')===777);
    assert('读档恢复手账1条', ev('G.rides.length')===1);

    /* ===== 餐车 ===== */
    const m0=ev('G.money');
    ev('buyMeal("矿泉水",5)');
    assert('餐车消费+1', ev('G.meals')===1);
    assert('金钱-5', ev('G.money')===m0-5);

    /* ===== 标签页渲染 ===== */
    ev("openPanel('ach')");
    assert('成就页含 16 张卡片', document.querySelectorAll('.ach-card').length===16);
    ev("openPanel('log')");
    assert('手账页显示 1 条', document.querySelectorAll('#modal-body .log-item').length===1);
    
    assert('订票区存在', !!document.getElementById('book-area'));
    ev("openPanel('set')");
    assert('设置页渲染', document.getElementById('modal-body').innerHTML.includes('报站语音'));

    /* ===== 真实 DOM 点击流程 ===== */
    ev('G=null;newGame()');
    
    const clickEv=new window.MouseEvent('click',{bubbles:true,cancelable:true});
    // 全展开紧凑网格：107 站（+6 换乘站重复）按钮全部可见（无展开/收起）
    assert('全部站点按钮可见(113=107+6换乘)', document.querySelectorAll('#line-panel .station-chip').length===113);
    assert('7 个线路分组', document.querySelectorAll('#line-panel .line-group').length===7);
    // 槽位式选站：点击第一个站=出发，自动切到到达
    const chipBj=[...document.querySelectorAll('#line-panel .station-chip')].find(b=>b.textContent.startsWith('北京南'));
    assert('面板有北京南', !!chipBj);
    chipBj.dispatchEvent(clickEv);
    assert('点第一个站=出发', ev('selFrom')==='北京南');
    assert('自动切到到达槽', ev('selSlot')==='to');
    assert('出发槽高亮切换', document.getElementById('slot-to').classList.contains('active'));
    const chipSh=[...document.querySelectorAll('#line-panel .station-chip')].find(b=>b.textContent.startsWith('上海虹桥'));
    chipSh.dispatchEvent(clickEv);
    assert('点第二个站=到达', ev('selTo')==='上海虹桥');
    // 拼音首字母搜索
    ev("filterStations('bjn')");
    assert('bjn 命中北京南/宝鸡南', document.querySelectorAll('#line-panel .station-chip').length===2);
    ev("filterStations('shhq')");
    assert('shhq 命中上海虹桥(2线各一次)', document.querySelectorAll('#line-panel .station-chip').length===2);
    ev("filterStations('杭州')");
    assert('汉字搜索命中杭州东/杭州南(3处)', document.querySelectorAll('#line-panel .station-chip').length===3);
    ev("filterStations('')");
    assert('清空搜索恢复全部站点', document.querySelectorAll('#line-panel .station-chip').length===113);
    // 槽位切换与重选
    ev("setSlot('from')");
    ev("pickStation('长沙南')");
    assert('重选出发展为长沙南', ev('selFrom')==='长沙南' && ev('selSlot')==='to');
    ev("setSlot('to');pickStation('长沙南')");
    assert('出发到达相同被拦截(到达不变)', ev('selTo')==='上海虹桥');
    assert('订票面板显示车次', document.getElementById('book-area').innerHTML.includes('选择车次'));

    /* ===== 出发/到达联动 ===== */
    ev('resetPick()');
    ev("setSlot('from');pickStation('北京南')");
    assert('选出发北京南', ev('selFrom')==='北京南' && ev('selSlot')==='to');
    // 北京南（京沪线）→ 上海虹桥可达、深圳北不可达
    const disabledCount=document.querySelectorAll('#line-panel .station-chip.disabled').length;
    assert('北京南出发后存在置灰不可达站', disabledCount>0);
    assert('深圳北被置灰(不可达)', [...document.querySelectorAll('#line-panel .station-chip.disabled')].some(b=>b.textContent.startsWith('深圳北')));
    assert('上海虹桥可达(未置灰)', ![...document.querySelectorAll('#line-panel .station-chip.disabled')].some(b=>b.textContent.startsWith('上海虹桥')));
    assert('联动提示显示可达站数', document.getElementById('link-hint').textContent.includes('可直达'));
    // 点击不可达站被拦截
    ev("setSlot('to');pickStation('深圳北')");
    assert('不可达站被拦截', ev('selTo')===null && ev('selSlot')==='to');
    // 换出发：北京南 → 哈尔滨西（不同线），已选到达上海虹桥自动清空
    ev("setSlot('from');pickStation('哈尔滨西')");
    assert('换出发哈尔滨西', ev('selFrom')==='哈尔滨西');
    assert('不可达的旧到达被清空', ev('selTo')===null);
    // 哈尔滨西（哈大线）→ 大连北 可达
    ev("setSlot('to');pickStation('大连北')");
    assert('哈尔滨西→大连北可达', ev('selTo')==='大连北');
    // 交换后联动反转
    ev('swapPick()');
    assert('交换后出发=大连北', ev('selFrom')==='大连北' && ev('selTo')==='哈尔滨西');
    assert('大连北出发可达哈尔滨西', ![...document.querySelectorAll('#line-panel .station-chip.disabled')].some(b=>b.textContent.startsWith('哈尔滨西')));
    // 跨线联动：北京朝阳→哈尔滨西 可达（G101 跨线车）
    ev("setSlot('from');pickStation('北京朝阳');setSlot('to');pickStation('哈尔滨西')");
    assert('跨线车联动(北京朝阳→哈尔滨西)', ev('selFrom')==='北京朝阳' && ev('selTo')==='哈尔滨西');
    assert('北京朝阳出发哈尔滨西未置灰', ![...document.querySelectorAll('#line-panel .station-chip.disabled')].some(b=>b.textContent.startsWith('哈尔滨西')));
    // 恢复北京南→上海虹桥继续购票流程
    ev('resetPick()');
    ev("setSlot('from');pickStation('北京南');setSlot('to');pickStation('上海虹桥')");
    assert('恢复北京南→上海虹桥', ev('selFrom')==='北京南' && ev('selTo')==='上海虹桥');

    const trainLis=[...document.querySelectorAll('#book-area .train-list li')];
    assert('真实车次列表(前12+展开按钮)', trainLis.length===12 && document.getElementById('book-area').textContent.includes('展开全部'));
    trainLis[0].dispatchEvent(clickEv);
    assert('点击选择车次成功', ev('selTrain')!==null && ev('RAIL.realTrains[selTrain]')!==undefined);
    ev('bookShowAll=true;renderBookTab()');
    assert('展开全部车次(38趟)', document.querySelectorAll('#book-area .train-list li').length===38);
    const seatBtns=[...document.querySelectorAll('#book-area .seat-btn')];
    seatBtns[2].dispatchEvent(clickEv);
    assert('点击选择商务座', ev('selSeat')==='商务座');
    const buyBtn=[...document.querySelectorAll('#book-area button')].find(b=>b.textContent.includes('购票出发'));
    assert('有购票按钮', !!buyBtn);
    buyBtn.dispatchEvent(clickEv);
    assert('点击购票后行程建立', ev('TRIP!==null'));
    assert('点击购票后金额减少', ev('G.money')<3000);
    ev('if(rafId){cancelAnimationFrame(rafId);rafId=null;}');
    ev('skipToEnd()');
    assert('点击流程完整到站并记账', ev('G.rides.length')===1);
    assert('到站结算弹窗显示', !document.getElementById('modal-bg').classList.contains('hidden'));
    ev('closeModal()');

    console.log('---RESULT---');
    console.log('PASS',pass,'FAIL',fail);
    process.exit(fail?1:0);
  }catch(e){
    console.error('ERROR',e);
    try{console.log('STATE:',ev('selFrom'),ev('selTo'),ev('selSlot'),ev('selTrain'));}catch(e2){}
    process.exit(1);
  }
},500);
