import { MOTION_LABELS, vehicleMotionState } from './vehicle-motion';
import { createIcons, Route, SlidersHorizontal, CircleHelp, Save, Blocks, CarFront, MousePointer2, Spline, Waypoints, RotateCw, House, TrafficCone, Eraser, MoveHorizontal, Sparkles, Bike, Truck, Scan, ShieldCheck, Undo2, FolderOpen, Sun, Moon, Focus, Layers2, Plus, Minus, Navigation2, Pause, Play, Clock3, Mouse, Activity, X, ArrowUpRight } from 'lucide';
import './style.css';
import { Timeline } from './timeline';
import { blockerBearing, selectedBlocker } from './vehicle-blockage';
import { STATE_LABELS } from './driving';
import { CityScene } from './scene';
import { defaultObservationProfiles, readObservationProfiles, type ObservationProfiles } from './vehicle-observation';
import { World, Simulation, demoWorld, pt, curve, dist, sampled, type Point, type DrivingSide, type VehicleKind, protectedSignalPhases, SPECS } from './simulation';

const icons={Route,SlidersHorizontal,CircleHelp,Save,Blocks,CarFront,MousePointer2,Spline,Waypoints,RotateCw,House,TrafficCone,Eraser,MoveHorizontal,Sparkles,Bike,Truck,Scan,ShieldCheck,Undo2,FolderOpen,Sun,Moon,Focus,Layers2,Plus,Minus,Navigation2,Pause,Play,Clock3,Mouse,Activity,X,ArrowUpRight};

const icon=(name:string,cls='')=>`<i data-lucide="${name}" class="${cls}"></i>`;
const tools=[{id:'select',icon:'mouse-pointer-2',name:'Khám phá',key:'1'},{id:'road',icon:'route',name:'Đường thẳng',key:'2'},{id:'curve',icon:'spline',name:'Đường cong',key:'3'},{id:'bridge',icon:'waypoints',name:'Cầu vượt',key:'4'},{id:'roundabout',icon:'rotate-cw',name:'Vòng xoay',key:'5'},{id:'house',icon:'house',name:'Nhà ở',key:'6'},{id:'light',icon:'traffic-cone',name:'Đèn tín hiệu',key:'7'},{id:'delete',icon:'eraser',name:'Tháo dỡ',key:'8'}];
document.querySelector('#app')!.innerHTML=`
<header class="topbar"><a class="brand" href="./" aria-label="Phố Flow">${icon('route')}<span>phố<span class="brand-light">flow</span><small>TRAFFIC SANDBOX</small></span></a><span class="header-divider"></span><div class="project-name">Khu phố của bạn <span class="tag">SANDBOX</span><small><span class="status-dot"></span> <span id="save-status">Tự do xây dựng. Tự do khám phá.</span></small></div><div class="header-actions"><button id="help" class="plain-button">${icon('circle-help')}<span>Hướng dẫn</span></button><button id="save" class="save-button">${icon('save')}<span>Lưu thành phố</span></button></div></header>
<main class="workspace"><aside class="sidebar"><div class="section-heading"><span>XƯỞNG THÀNH PHỐ</span>${icon('sliders-horizontal')}</div><h1>Mọi hành trình<br>bắt đầu từ một con đường.</h1><p class="intro">Vẽ đường. Kết nối. Để thành phố chuyển động.</p>
<div class="tabs"><button class="active" id="tab-build">${icon('blocks')} Xây dựng</button><button id="tab-traffic">${icon('car-front')} Giao thông</button></div>
<div id="build-panel"><div class="label-row"><h2>Công cụ xây dựng</h2><span>01 — 08</span></div><div class="tool-grid">${tools.map(t=>`<button class="tool ${t.id==='select'?'active':''}" data-tool="${t.id}" title="${t.name} (${t.key})"><span class="tool-key">${t.key}</span>${icon(t.icon)}<span>${t.name}</span></button>`).join('')}</div>
<section class="settings-card"><div class="label-row"><h2 id="settings-title">Thiết lập đường</h2><span class="mini-tag">HAI CHIỀU</span></div><label class="range-label" for="road-width">Bề rộng mỗi chiều <strong><span id="width-value">5</span><small> m</small></strong></label><input id="road-width" type="range" min="3" max="10" step=".5" value="5"/><div class="range-ticks"><span>3 m</span><span>10 m</span></div><div class="road-diagram"><span class="diagram-car"></span><span class="diagram-bike"></span><span class="diagram-truck"></span><div class="diagram-line"></div><span class="diagram-arrow">←</span><span class="diagram-arrow right">→</span></div><div class="settings-note">${icon('move-horizontal')}<span>Nhiều xe có thể chạy song song khi đường đủ rộng.</span></div><div id="bridge-setting" hidden><label class="range-label" for="bridge-height">Độ cao cầu <strong><span id="height-value">6</span> m</strong></label><input id="bridge-height" type="range" min="4" max="12" value="6"/></div><div id="round-setting" hidden><label class="range-label" for="round-radius">Bán kính vòng xoay <strong><span id="radius-value">12</span> m</strong></label><input id="round-radius" type="range" min="8" max="22" value="12"/></div><div id="selected-road" hidden><label for="road-priority">Mức ưu tiên</label><select id="road-priority"><option value="0">Đường thường</option><option value="1">Đường chính</option></select><label for="road-control">Khi tới giao lộ</label><select id="road-control"><option value="none">Theo quyền ưu tiên</option><option value="yield">Nhường đường</option><option value="stop">Dừng bắt buộc</option></select><label for="junction-mode">Giao lộ ở hai đầu đoạn đường</label><select id="junction-mode"><option value="priority">Theo ưu tiên và thứ tự đến</option><option value="zipper">Nhập dòng luân phiên</option><option value="all-way-stop">Dừng rồi đi theo lượt</option></select><button id="apply-width" class="wide-button">Áp dụng cho đoạn đường đã chọn</button></div></section>
<div class="tip-card">${icon('sparkles')}<div><strong>Một thành phố, vô vàn lối đi</strong><p id="tool-hint">Chọn một công cụ để bắt đầu. Kéo bản đồ để khám phá khu phố.</p></div></div></div>
<div id="traffic-panel" hidden><div class="label-row"><h2>Nhịp sống thành phố</h2><span>LIVE</span></div><section class="settings-card driving-side-card"><label for="driving-side">Phía lưu thông</label><select id="driving-side" aria-describedby="driving-side-note"><option value="right" selected>Đi bên phải</option><option value="left">Đi bên trái</option></select><p id="driving-side-note">Áp dụng cho toàn thành phố và chiều vòng xoay. Đổi phía sẽ bắt đầu lại lượt xe.</p></section><section class="settings-card driving-side-card"><label for="signal-plan">Pha đèn giao lộ</label><select id="signal-plan"><option value="shared">Hai hướng, có đèn vàng</option><option value="protected">Các pha đi thẳng và rẽ riêng</option></select><p>Áp dụng cho các đèn hiện có. Xe chỉ vào giao lộ khi phía ra đủ chỗ.</p></section><p class="panel-copy">Bấm vào một xe trên bản đồ để xem riêng hướng đi. Bật công tắc bên dưới để xem tất cả xe.</p><div class="vehicle-list">${(['bike','car','truck'] as VehicleKind[]).map((k,i)=>`<label class="vehicle-row"><span class="vehicle-symbol ${k}">${icon(['bike','car-front','truck'][i])}</span><span><strong>${['Xe máy','Xe con','Xe tải'][i]}</strong><small>${SPECS[k].width} × ${SPECS[k].length} m</small></span><input type="checkbox" data-kind="${k}" checked/></label>`).join('')}</div><section class="settings-card observation-card"><div class="label-row"><h2>Vùng quan sát</h2><span class="mini-tag">XE ĐANG CHỌN</span></div><label class="observation-toggle"><input type="checkbox" id="show-observation" checked/> Hiện vùng quan sát</label><label for="observation-kind">Loại phương tiện</label><select id="observation-kind"><option value="bike">Xe máy</option><option value="car">Xe con</option><option value="truck">Xe tải</option></select><p>Chọn một xe trên bản đồ để xem vùng của xe đó. Cài đặt áp dụng cho mọi xe cùng loại.</p><div class="observation-side front"><strong>Phía trước</strong><label for="observation-front-range">Tầm nhìn <output id="observation-front-range-value"></output></label><input type="range" id="observation-front-range" min="0" max="50" step="1"/><label for="observation-front-angle">Góc quan sát <output id="observation-front-angle-value"></output></label><input type="range" id="observation-front-angle" min="0" max="360" step="5"/><label for="observation-front-verticalAngle">Góc lên / xuống <output id="observation-front-verticalAngle-value"></output></label><input type="range" id="observation-front-verticalAngle" min="0" max="180" step="5"/></div><div class="observation-side rear"><strong>Phía sau</strong><label for="observation-rear-range">Tầm nhìn <output id="observation-rear-range-value"></output></label><input type="range" id="observation-rear-range" min="0" max="50" step="1"/><label for="observation-rear-angle">Góc quan sát <output id="observation-rear-angle-value"></output></label><input type="range" id="observation-rear-angle" min="0" max="360" step="5"/><label for="observation-rear-verticalAngle">Góc lên / xuống <output id="observation-rear-verticalAngle-value"></output></label><input type="range" id="observation-rear-verticalAngle" min="0" max="180" step="5"/></div><button type="button" id="observation-reset">Khôi phục loại xe này</button><p>Góc là tổng độ mở ngang và lên/xuống. Vùng xanh lam: trước · vùng hồng: sau; vùng được giới hạn theo vật cản. Tầm nhìn tính từ vị trí quan sát của xe.</p></section><section class="settings-card"><label class="range-label" for="density">Số xe mục tiêu <strong id="density-value">50</strong></label><input id="density" type="range" min="5" max="120" step="5" value="50"/><div class="range-ticks"><span>Thư thả</span><span>Giờ cao điểm</span></div></section><label class="toggle-row"><span>${icon('navigation-2')} Hiện hướng tất cả xe</span><input type="checkbox" id="show-directions" aria-describedby="directions-note"/></label><div id="directions-legend" class="directions-legend" hidden><span class="direction-bike">Xe máy</span><span class="direction-car">Xe con</span><span class="direction-truck">Xe tải</span><p id="directions-note">Vùng màu là không gian thân xe dự kiến quét qua trong 30 m tới; các khung thể hiện chiều dài và bề rộng xe khi rẽ. Mũi tên chỉ hướng đi. Đây là dự báo, không phải xác nhận không va chạm; xe có thể đổi hướng khi tránh nhau.</p></div><label class="toggle-row"><span>${icon('scan')} Hiện khung va chạm</span><input type="checkbox" id="debug"/></label><div class="tip-card">${icon('shield-check')}<div><strong>Khoảng trống tạo nên dòng chảy</strong><p>Xe giảm tốc, nhường đường và tìm khoảng trống để lách. Thêm đường nối để giải tỏa các điểm nghẽn.</p></div></div></div>
<div class="sidebar-bottom"><button id="undo" title="Hoàn tác (Ctrl+Z)">${icon('undo-2')} Hoàn tác</button><button id="load" title="Tải bản đồ đã lưu">${icon('folder-open')} Mở bản lưu</button></div></aside>
<section class="viewport" aria-label="Bản đồ thành phố 3D"><canvas id="city-canvas" aria-label="Bản đồ xây dựng tương tác"></canvas><div class="map-top"><div class="city-chip"><span class="live-dot"></span><div><strong>Thành phố đang chuyển động</strong><small id="city-subtitle">Một góc nhỏ, những hành trình lớn.</small></div></div><button id="day-night" class="floating-button" title="Đổi ngày / đêm">${icon('sun')}</button></div>
<section id="vehicle-inspector" class="vehicle-inspector" aria-label="Phương tiện đang chọn" hidden><div class="inspector-heading"><span>${icon('navigation-2')} ĐANG XEM RIÊNG</span><button id="clear-vehicle" aria-label="Bỏ chọn phương tiện" title="Bỏ chọn (Esc)">${icon('x')}</button></div><strong id="vehicle-name"></strong><p id="vehicle-motion" aria-live="polite"></p><p id="vehicle-acceleration" title="Giá trị dương: tăng tốc; âm: giảm tốc; gần 0: giữ tốc độ. Khi lùi, gia tốc tính theo độ lớn tốc độ."></p><p id="vehicle-details"></p><p id="vehicle-blockage" hidden></p><small>Đường và khung xanh lam: xe quan sát phía trước · hồng: phía sau. Chỉnh vùng ở tab Giao thông.<br>Vùng xanh: phạm vi đánh lái khi tiến · vùng cam: khi lùi.<br>Đường trắng: cung theo góc lái hiện tại (tiến và lùi).<br>Vùng đánh lái tính theo tâm xe, chưa xét vật cản hoặc bề rộng thân xe.<br>Vùng màu: không gian thân xe quét qua.<br>Khung xe: kích thước và góc xoay trong 30 m tới.<br>Dự báo có thể đổi khi xe tránh nhau.<br>Bấm xe khác để đổi · Bấm chỗ trống hoặc Esc để bỏ chọn.</small></section>
<div class="map-title"><span>THẾ GIỚI CỦA BẠN</span><h2>Một nhịp sống mới.</h2><p>Xây những con đường. Mở những khả năng.</p></div>
<div class="map-controls" role="group" aria-label="Điều khiển camera"><button id="camera-rotate" title="Tắt kéo để xoay camera" aria-label="Kéo để xoay camera" aria-pressed="true">${icon('rotate-cw')}</button><div class="camera-orbit"><button id="camera-up" title="Nhìn từ cao hơn · 15°" aria-label="Nâng góc nhìn 15 độ">↑</button><button id="camera-left" title="Xoay trái 45°" aria-label="Xoay trái 45 độ">↶</button><button id="camera-right" title="Xoay phải 45°" aria-label="Xoay phải 45 độ">↷</button><button id="camera-down" title="Nhìn từ thấp hơn · 15°" aria-label="Hạ góc nhìn 15 độ">↓</button></div><span></span><button id="camera-home" title="Đặt lại góc nhìn">${icon('focus')}</button><button id="camera-top" title="Góc nhìn từ trên xuống">${icon('layers-2')}</button><span></span><button id="zoom-in" title="Phóng to">${icon('plus')}</button><button id="zoom-out" title="Thu nhỏ">${icon('minus')}</button></div>
<div class="compass"><span>N</span>${icon('navigation-2')}<small>100 m</small><div></div></div><div id="drawing-banner" class="drawing-banner" hidden><span id="drawing-text"></span><button id="cancel-draw">Hủy <kbd>Esc</kbd></button></div>
<div class="time-travel"><button id="rewind-time" title="Lùi 5 giây">↶ 5s</button><label for="timeline">Tua thời gian <output id="timeline-time">0:00 / 0:00</output></label><input id="timeline" type="range" min="0" max="0" step="0.5" value="0" aria-label="Tua thời gian mô phỏng"/><button id="latest-time" title="Về mốc mới nhất đã lưu">Mới nhất</button><small>Kéo để xem · Bấm ▶ để chạy tiếp từ mốc đã chọn</small></div><div class="bottom-hud"><div class="playback"><button id="play-pause" class="play-pause" title="Tạm dừng (Space)">${icon('pause')}</button><div class="speed-group"><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button></div><span class="hud-divider"></span><div class="simulation-time">${icon('clock-3')}<span id="sim-time">08:00</span></div></div><div class="map-shortcuts"><span>${icon('mouse')} <span id="camera-gesture">Kéo chuột trái để xoay</span></span><span>Cuộn để thu phóng</span><span>Shift + kéo để di chuyển</span></div></div>
<div id="toast" class="toast" role="status"></div><div class="loading" id="loading"><div class="loading-mark">${icon('route')}</div><strong>Đang đánh thức thành phố…</strong></div></section>
<footer class="statsbar"><div class="stat-item"><span class="stat-icon mint">${icon('car-front')}</span><div><span>Đang lưu thông</span><strong id="stat-vehicles">0<small> phương tiện</small></strong></div></div><div class="stat-item"><span class="stat-icon blue">${icon('route')}</span><div><span>Mạng lưới đường</span><strong id="stat-roads">0<small> m</small></strong></div></div><div class="stat-item"><span class="stat-icon peach">${icon('house')}</span><div><span>Nhà đã kết nối</span><strong id="stat-houses">0<small> ngôi nhà</small></strong></div></div><div class="stat-item"><span class="stat-icon lavender">${icon('activity')}</span><div><span>Lưu thông</span><strong id="stat-flow">100<small> % thông thoáng</small></strong></div></div><div class="completed"><span class="status-dot"></span><span id="stat-completed">0 hành trình hoàn thành</span></div></footer></main>
<dialog id="help-dialog"><button class="dialog-close" id="close-help" aria-label="Đóng">${icon('x')}</button><span class="eyebrow">CHÀO MỪNG ĐẾN PHỐ FLOW</span><h2>Thành phố trong tay bạn.</h2><p>Không điểm số. Không giới hạn ngân sách.<br>Chỉ có bạn và những con đường đầy khả năng.</p><div class="help-steps"><div><b>01</b><span><strong>Vẽ một con đường</strong>Chọn đường thẳng hoặc cầu: bấm điểm đầu, rồi điểm cuối. Đường cong: chọn điểm đầu, điểm cuối, rồi điểm uốn. Đường tự nối khi chạm hoặc giao nhau cùng cao độ.</span></div><div><b>02</b><span><strong>Thổi sự sống vào khu phố</strong>Đặt nhà cạnh đường, cách mép ít nhất 4 m. Xe xuất phát từ nhà và tìm đường đến một nhà khác. Đặt vòng xoay tại giao lộ hoặc đèn tín hiệu để điều tiết.</span></div><div><b>03</b><span><strong>Tìm nhịp chảy của riêng bạn</strong>Chỉnh bề rộng mỗi chiều từ 3–10 m, thêm nhánh đường và quan sát. Chọn Khám phá rồi bấm một đường để đổi bề rộng. Tab Giao thông cho phép đổi loại xe và mật độ.</span></div></div><div class="help-keys"><span>Nút ↶ ↷ xoay 45° · ↑ ↓ chỉnh góc cao/thấp</span><span>Chế độ xoay: kéo để nhìn quanh · Shift + kéo để di chuyển</span><span>Cảm ứng: một ngón kéo · hai ngón thu phóng và xoay</span><span><kbd>1</kbd>–<kbd>8</kbd> Công cụ</span><span><kbd>Space</kbd> Tạm dừng</span><span><kbd>Esc</kbd> Hủy vẽ</span><span><kbd>Ctrl Z</kbd> Hoàn tác</span></div><button id="start-building" class="save-button">Bắt đầu khám phá ${icon('arrow-up-right')}</button><p class="local-note">Bản đồ được lưu trên trình duyệt hiện tại. Các thay đổi đường sá khởi động lại lượt xe để cập nhật hành trình.</p></dialog>`;
createIcons({icons});
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let world:World=demoWorld(),sim=new Simulation(world);const timeline=new Timeline(sim);let scene:CityScene;
try{scene=new CityScene($<HTMLCanvasElement>('city-canvas'),document.querySelector('.viewport')!);}catch(e){$('loading').innerHTML='<strong>Không khởi tạo được đồ họa 3D.</strong><p>Hãy bật tăng tốc phần cứng hoặc mở bằng Chrome / Edge mới.</p>';throw e;}
scene.rebuild(world);$('loading').hidden=true;
scene.setCameraInteraction(true,true);
const observationStorageKey='pho-flow-observation-v1';
let observationProfiles:ObservationProfiles;
try{observationProfiles=readObservationProfiles(JSON.parse(localStorage.getItem(observationStorageKey)??'null'));}catch{observationProfiles=defaultObservationProfiles();}
scene.observationGuide.profiles=observationProfiles;
sim.observationProfiles=observationProfiles;
const observationKind=()=> $<HTMLSelectElement>('observation-kind').value as VehicleKind;
function showObservationSettings(){
  const profile=observationProfiles[observationKind()];
  for(const side of ['front','rear'] as const)for(const field of ['range','angle','verticalAngle'] as const){
    const id=`observation-${side}-${field}`,value=profile[side][field];
    $<HTMLInputElement>(id).value=String(value);$(`${id}-value`).textContent=`${value} ${field==='range'?'m':'°'}`;
  }
}
function saveObservationSettings(){try{localStorage.setItem(observationStorageKey,JSON.stringify(observationProfiles));}catch{/* Settings remain available for this session. */}}
$('observation-kind').onchange=showObservationSettings;
$<HTMLInputElement>('show-observation').onchange=e=>{scene.observationGuide.enabled=(e.target as HTMLInputElement).checked;};
for(const side of ['front','rear'] as const)for(const field of ['range','angle','verticalAngle'] as const){
  const input=$<HTMLInputElement>(`observation-${side}-${field}`);
  input.oninput=()=>{observationProfiles[observationKind()][side][field]=Number(input.value);showObservationSettings();saveObservationSettings();};
}
$('observation-reset').onclick=()=>{observationProfiles[observationKind()]=defaultObservationProfiles()[observationKind()];showObservationSettings();saveObservationSettings();};
showObservationSettings();
let rotateCamera=true;
let tool='select',width=5,bridgeHeight=6,roundRadius=12,speed=1,anchors:Point[]=[],hover:Point|null=null,selectedRoad:number|null=null,history:string[]=[],dirty=false;
let toastTimer=0;
function toast(message:string){$('toast').textContent=message;$('toast').classList.add('show');window.clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('toast').classList.remove('show'),4000);}
function clearVehicleSelection(){scene.selectedVehicleId=null;$('vehicle-inspector').hidden=true;}
function updateVehicleInspector(){
  const vehicle=sim.vehicles.find(v=>v.id===scene.selectedVehicleId);
  $('vehicle-inspector').hidden=!vehicle;
  if(!vehicle)return;
  const names:Record<VehicleKind,string>={bike:'Xe máy',car:'Xe con',truck:'Xe tải'};
  const blocker=selectedBlocker(vehicle,sim.vehicles);
  const blockage=$('vehicle-blockage');
  blockage.hidden=!blocker&&vehicle.state!=='blocked';
  if(blocker){
    const bearing=blockerBearing(vehicle,blocker);
    blockage.textContent=`Xe #${blocker.id} ở ${bearing.direction} · lệch ${bearing.degrees}° so với đầu xe · cách tâm ${bearing.distance.toFixed(1)} m. Khung đỏ và đường nối chỉ xe đang khiến xe này chờ; đây không phải điểm va chạm chính xác.`;
  }else if(vehicle.state==='blocked')blockage.textContent='Chưa xác định được xe gây cản. Xe có thể thiếu khoảng trống cho thân xe hoặc cung rẽ.';
  const motion=vehicleMotionState(vehicle);
  $('vehicle-motion').textContent=`Trạng thái xe: ${MOTION_LABELS[motion]}`;
  $('vehicle-motion').dataset.state=motion;
  const acceleration=vehicle.acceleration??0;
  const roundedAcceleration=Number(acceleration.toFixed(2));
  $('vehicle-acceleration').textContent=`Gia tốc: ${roundedAcceleration>0?'+':''}${roundedAcceleration.toFixed(2)} m/s²`;
  $('vehicle-name').textContent=`${names[vehicle.kind]} #${vehicle.id}`;
  $('vehicle-details').textContent=`${Math.round(Math.abs(vehicle.velocity??vehicle.speed)*3.6)} km/h · Còn ${Math.ceil(Math.max(0,vehicle.route.total-vehicle.s))} m · ${STATE_LABELS[vehicle.state??'driving']} — ${vehicle.reason??'Đường thông thoáng'}`;
}
function selectVehicle(id:number){
  selectedRoad=null;$('selected-road').hidden=true;scene.preview([],width);
  scene.selectedVehicleId=id;const vehicle=sim.vehicles.find(v=>v.id===id);if(vehicle){$<HTMLSelectElement>('observation-kind').value=vehicle.kind;showObservationSettings();}scene.showDirections=false;$<HTMLInputElement>('show-directions').checked=false;
  $('directions-legend').hidden=false;updateVehicleInspector();
}
$('clear-vehicle').onclick=()=>{clearVehicleSelection();$('directions-legend').hidden=!scene.showDirections;};
function checkpoint(){history.push(world.serialize());if(history.length>25)history.shift();}
function changed(message:string){$<HTMLSelectElement>('signal-plan').value=world.lights.some(l=>l.phases)?'protected':'shared';$<HTMLSelectElement>('driving-side').value=world.drivingSide;document.querySelector('.diagram-arrow')!.textContent=world.drivingSide==='right'?'←':'→';document.querySelector('.diagram-arrow.right')!.textContent=world.drivingSide==='right'?'→':'←';clearVehicleSelection();$('directions-legend').hidden=!scene.showDirections;sim.reset();timeline.reset();scene.rebuild(world);dirty=true;$('save-status').textContent='Có thay đổi chưa lưu';anchors=[];scene.preview([],width);updateBanner();updateStats();toast(message);}
const hints:Record<string,string>={select:'Bấm một xe để xem riêng hướng đi, hoặc bấm đường để chỉnh bề rộng. Kéo chuột trái để xoay góc nhìn. Giữ Shift khi kéo để di chuyển.',road:'Bấm điểm đầu và điểm cuối. Đường tự nối vào đoạn đường gần nhất.',curve:'Bấm điểm đầu, điểm cuối, rồi đặt điểm uốn để tạo đường cong.',bridge:'Bấm hai đầu cầu. Nhịp cầu nâng lên, hai đầu nối với đường ở mặt đất.',roundabout:'Bấm một giao lộ để thay bằng vòng xoay. Đường đi theo một chiều quanh đảo.',house:'Bấm cạnh đường để xây nhà. Chừa ít nhất 4 m từ mép đường cho lối ra vào.',light:'Bấm một giao lộ mặt đất để đặt hoặc gỡ đèn tín hiệu.',delete:'Bấm ngôi nhà, đèn hoặc đoạn đường cần tháo dỡ. Có thể hoàn tác bằng Ctrl+Z.'};
function setTool(next:string){clearVehicleSelection();$('directions-legend').hidden=!scene.showDirections;tool=next;anchors=[];selectedRoad=null;scene.preview([],width);document.querySelectorAll('[data-tool]').forEach(el=>el.classList.toggle('active',(el as HTMLElement).dataset.tool===tool));$('tool-hint').textContent=hints[tool];$('bridge-setting').hidden=tool!=='bridge';$('round-setting').hidden=tool!=='roundabout';$('selected-road').hidden=true;scene.setCameraInteraction(rotateCamera,tool==='select');scene.canvas.style.cursor=tool==='select'?'grab':tool==='delete'?'not-allowed':'crosshair';updateBanner();}
function updateBanner(){const active=tool!=='select';$('drawing-banner').hidden=!active;$('drawing-text').textContent=tool==='curve'?['Chọn điểm bắt đầu','Chọn điểm kết thúc','Di chuyển để uốn đường · Bấm để xây'][anchors.length]:['road','bridge'].includes(tool)?(anchors.length?'Chọn điểm kết thúc · Bấm để xây':'Chọn điểm bắt đầu'):hints[tool];}
function getPath(p:Point){if(!anchors.length)return[p];if(tool==='curve'&&anchors.length===2)return curve(anchors[0],p,anchors[1]);if(tool==='bridge'){const a=anchors[0],b=p;return Array.from({length:49},(_,i)=>{const t=i/48;return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,y:a.y+(b.y-a.y)*t+Math.sin(t*Math.PI)*bridgeHeight};});}return[anchors[0],p];}
function preview(p:Point){if(['road','curve','bridge'].includes(tool))scene.preview(getPath(tool==='curve'&&anchors.length===2?p:world.snap(p)),width);else if(tool==='roundabout'){const points=Array.from({length:65},(_,i)=>pt(p.x+Math.cos(i/64*Math.PI*2)*roundRadius,p.z+Math.sin(i/64*Math.PI*2)*roundRadius));scene.preview(points,width/2);}else scene.preview([p],width);}
function clickMap(p:Point){
  if(Math.abs(p.x)>115||Math.abs(p.z)>96){toast('Hãy xây dựng bên trong khu đất.');return;}
  if(tool==='select'){const q=world.nearest(p);if(q&&q.distance<q.road.width+2){selectedRoad=q.road.id;width=q.road.width;$<HTMLInputElement>('road-width').value=String(width);$('width-value').textContent=String(width);$<HTMLSelectElement>('road-priority').value=String(q.road.priority??0);$<HTMLSelectElement>('road-control').value=q.road.control??'none';$<HTMLSelectElement>('junction-mode').value=q.road.junctionMode??'priority';$('selected-road').hidden=false;scene.preview(q.road.points,q.road.oneWay?width/2:width);toast(`Đã chọn đường ${q.road.oneWay?'một chiều':'hai chiều'} · ${width} m mỗi chiều`);}return;}
  if(['road','curve','bridge'].includes(tool)){
    const snap=tool==='curve'&&anchors.length===2?p:world.snap(p);
    if(!anchors.length){anchors.push(snap);updateBanner();return;}
    if(tool==='curve'&&anchors.length===1){if(dist(snap,anchors[0])<8){toast('Đường cần dài ít nhất 8 m.');return;}anchors.push(snap);updateBanner();return;}
    const path=getPath(snap);if(dist(path[0],path.at(-1)!)<8){toast('Đường cần dài ít nhất 8 m.');return;}
    if(tool==='bridge'&&dist(path[0],path.at(-1)!)<bridgeHeight*5){toast(`Cầu cao ${bridgeHeight} m cần dài ít nhất ${bridgeHeight*5} m để có dốc thoải.`);return;}
    if(sampled(path).some(point=>world.houses.some(h=>Math.hypot(h.x-point.x,h.z-point.z)<width+4))){toast('Đường vướng nhà. Hãy đổi hướng hoặc tháo dỡ nhà trước.');return;}
    checkpoint();world.addRoad(path,width);changed('Đã nối thêm một hành trình mới.');return;
  }
  if(tool==='house'){checkpoint();if(world.addHouse(p,world.houses.length%4))changed('Nhà mới đã sẵn sàng đón những hành trình.');else{history.pop();toast('Chọn chỗ trống cạnh đường, cách mép 4 m và cách nhà khác 9 m.');}return;}
  if(tool==='roundabout'){if(world.houses.some(h=>Math.abs(Math.hypot(h.x-p.x,h.z-p.z)-roundRadius)<width/2+5)){toast('Vòng xoay vướng nhà. Chọn vị trí trống hơn.');return;}checkpoint();world.roundabout(p,roundRadius,width);changed('Vòng xoay đã kết nối các nhánh đường.');return;}
  if(tool==='light'){const q=world.nearest(p);if(!q||q.distance>12||q.point.y>1){toast('Chọn một giao lộ ở mặt đất.');return;}const ends=world.roads.flatMap(r=>[r.points[0],r.points.at(-1)!]);const node=ends.sort((a,b)=>dist(a,p)-dist(b,p))[0];if(!node||dist(node,p)>14||ends.filter(e=>dist(e,node)<.3).length<3){toast('Đèn tín hiệu cần đặt tại nơi ít nhất ba nhánh đường gặp nhau.');return;}checkpoint();const index=world.lights.findIndex(l=>Math.hypot(l.x-node.x,l.z-node.z)<4);if(index>=0)world.lights.splice(index,1);else world.lights.push({x:node.x,z:node.z,offset:0,phases:$<HTMLSelectElement>('signal-plan').value==='protected'?protectedSignalPhases():undefined});changed(index>=0?'Đã gỡ đèn tín hiệu.':'Đã lắp đèn · có đèn vàng và khoảng dừng toàn bộ.');return;}
  if(tool==='delete'){const h=world.houses.find(h=>Math.hypot(h.x-p.x,h.z-p.z)<5),light=world.lights.find(l=>Math.hypot(l.x-p.x,l.z-p.z)<3),q=world.nearest(p);if(!h&&!light&&(!q||q.distance>q.road.width+1)){toast('Bấm vào công trình cần tháo dỡ.');return;}checkpoint();if(h)world.houses=world.houses.filter(v=>v!==h);else if(light)world.lights=world.lights.filter(v=>v!==light);else if(q)world.roads=world.roads.filter(r=>r!==q.road);changed('Đã tháo dỡ. Ctrl+Z để hoàn tác.');}
}
let down={x:0,y:0},dragged=false;
scene.canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};dragged=false;});
scene.canvas.addEventListener('pointerup',e=>{
  if(e.button!==0||dragged||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
  if(tool==='select'){
    const id=scene.pickVehicle(e.clientX,e.clientY,e.pointerType==='touch'?14:8);
    if(id!==null){selectVehicle(id);return;}
    clearVehicleSelection();$('directions-legend').hidden=!scene.showDirections;
  }
  const p=scene.pick(e.clientX,e.clientY);if(p)clickMap(p);
});
scene.canvas.addEventListener('pointermove',e=>{
  if(e.buttons&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)dragged=true;
  hover=scene.pick(e.clientX,e.clientY);if(hover&&tool!=='select')preview(hover);
});
scene.canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.querySelectorAll('[data-tool]').forEach(el=>el.addEventListener('click',()=>setTool((el as HTMLElement).dataset.tool!)));
$('road-width').addEventListener('input',()=>{width=Number($<HTMLInputElement>('road-width').value);$('width-value').textContent=String(width);if(hover&&tool!=='select')preview(hover);});
$('bridge-height').addEventListener('input',()=>{bridgeHeight=Number($<HTMLInputElement>('bridge-height').value);$('height-value').textContent=String(bridgeHeight);});
$('round-radius').addEventListener('input',()=>{roundRadius=Number($<HTMLInputElement>('round-radius').value);$('radius-value').textContent=String(roundRadius);});
$('apply-width').onclick=()=>{const road=world.roads.find(r=>r.id===selectedRoad);if(!road)return;checkpoint();road.width=width;road.priority=Number($<HTMLSelectElement>('road-priority').value);road.control=$<HTMLSelectElement>('road-control').value as 'none'|'yield'|'stop';road.junctionMode=$<HTMLSelectElement>('junction-mode').value as 'priority'|'zipper'|'all-way-stop';changed('Đã cập nhật bề rộng và quyền ưu tiên của đường.');$('selected-road').hidden=true;};
function undo(){const last=history.pop();if(!last){toast('Chưa có thay đổi để hoàn tác.');return;}world.restore(last);changed('Đã hoàn tác thay đổi gần nhất.');}
$('undo').onclick=undo;
$('cancel-draw').onclick=()=>{anchors=[];scene.preview([],width);setTool('select');};
for(const tab of ['build','traffic'])$(`tab-${tab}`).onclick=()=>{for(const other of ['build','traffic']){$(`tab-${other}`).classList.toggle('active',tab===other);$(`${other}-panel`).hidden=tab!==other;}if(tab==='traffic')setTool('select');};
document.querySelectorAll<HTMLInputElement>('[data-kind]').forEach(el=>el.onchange=()=>{sim.types[el.dataset.kind as VehicleKind]=el.checked;});
$('driving-side').onchange=()=>{const side=$<HTMLSelectElement>('driving-side').value as DrivingSide;if(side===world.drivingSide)return;checkpoint();world.setDrivingSide(side);changed(`Đã chuyển sang đi bên ${side==='right'?'phải':'trái'}.`);};
$('density').addEventListener('input',()=>{sim.target=Number($<HTMLInputElement>('density').value);$('density-value').textContent=String(sim.target);});
$('debug').onchange=()=>scene.debug=$<HTMLInputElement>('debug').checked;
$('show-directions').onchange=()=>{clearVehicleSelection();scene.showDirections=$<HTMLInputElement>('show-directions').checked;$('directions-legend').hidden=!scene.showDirections;};
$('signal-plan').onchange=()=>{
  checkpoint();const protectedTurns=$<HTMLSelectElement>('signal-plan').value==='protected';
  for(const light of world.lights)light.phases=protectedTurns?protectedSignalPhases():undefined;
  changed('Đã cập nhật pha đèn giao lộ.');
};
function pause(){sim.paused=!sim.paused;updatePlayback();}
function updatePlayback(){$('play-pause').innerHTML=icon(sim.paused?'play':'pause');$('play-pause').setAttribute('aria-label',sim.paused?'Tiếp tục':'Tạm dừng');document.querySelector('.live-dot')!.classList.toggle('paused',sim.paused);document.querySelector('.city-chip strong')!.textContent=sim.paused?'Thành phố đang tạm dừng':'Thành phố đang chuyển động';createIcons({icons});}
$('play-pause').onclick=pause;
function updateTimeline(){
  const input=$<HTMLInputElement>('timeline');
  input.min=String(timeline.start);input.max=String(Math.max(timeline.end,sim.time));input.value=String(sim.time);
  input.disabled=timeline.end===timeline.start;
  const format=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  $('timeline-time').textContent=`${format(sim.time)} / ${format(Math.max(timeline.end,sim.time))}`;
  $<HTMLButtonElement>('rewind-time').disabled=sim.time<=timeline.start;
  $<HTMLButtonElement>('latest-time').disabled=sim.time>=timeline.end;
}
function seekTime(time:number){
  timeline.seek(time);accumulator=0;updatePlayback();
  $<HTMLInputElement>('density').value=String(sim.target);$('density-value').textContent=String(sim.target);
  document.querySelectorAll<HTMLInputElement>('[data-kind]').forEach(el=>el.checked=sim.types[el.dataset.kind as VehicleKind]);
  scene.update(sim,1);updateStats();updateTimeline();
}
$('timeline').addEventListener('input',()=>seekTime(Number($<HTMLInputElement>('timeline').value)));
$('rewind-time').onclick=()=>seekTime(sim.time-5);
$('latest-time').onclick=()=>seekTime(timeline.end);
document.querySelectorAll<HTMLElement>('[data-speed]').forEach(el=>el.onclick=()=>{speed=Number(el.dataset.speed);document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',b===el));});
$('camera-rotate').onclick=()=>{
  rotateCamera=!rotateCamera;
  setTool('select');
  $('camera-rotate').setAttribute('aria-pressed',String(rotateCamera));
  $('camera-rotate').title=rotateCamera?'Tắt kéo để xoay camera':'Bật kéo để xoay camera';
  $('camera-gesture').textContent=rotateCamera?'Kéo chuột trái để xoay':'Kéo để di chuyển';
  toast(rotateCamera?'Kéo chuột hoặc một ngón tay để xoay và đổi góc cao thấp. Giữ Shift khi kéo để di chuyển.':'Kéo để di chuyển bản đồ. Chuột phải để xoay.');
};
$('camera-left').onclick=()=>scene.orbit(-Math.PI/4);
$('camera-right').onclick=()=>scene.orbit(Math.PI/4);
$('camera-up').onclick=()=>scene.orbit(0,-Math.PI/12);
$('camera-down').onclick=()=>scene.orbit(0,Math.PI/12);
$('camera-home').onclick=()=>scene.home();$('camera-top').onclick=()=>scene.top();$('zoom-in').onclick=()=>scene.zoom(1.2);$('zoom-out').onclick=()=>scene.zoom(1/1.2);
$('day-night').onclick=()=>{scene.setNight(!scene.night);$('day-night').innerHTML=icon(scene.night?'moon':'sun');createIcons({icons});};
$('save').onclick=()=>{try{localStorage.setItem('pho-flow-city-v1',world.serialize());dirty=false;$('save-status').textContent='Đã lưu trên trình duyệt này';toast('Đã lưu thành phố trên thiết bị của bạn.');}catch{toast('Không lưu được: bộ nhớ trình duyệt không khả dụng.');}};
$('load').onclick=()=>{try{const saved=localStorage.getItem('pho-flow-city-v1');if(!saved){toast('Chưa có bản lưu. Hãy lưu thành phố trước.');return;}checkpoint();world.restore(saved);changed('Đã mở bản lưu thành phố.');dirty=false;$('save-status').textContent='Đã tải bản lưu';}catch{toast('Không thể đọc bản lưu trong trình duyệt.');}};
const dialog=$<HTMLDialogElement>('help-dialog');$('help').onclick=()=>dialog.showModal();$('close-help').onclick=()=>dialog.close();$('start-building').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
document.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,textarea,select')||dialog.open)return;if(e.key==='Escape'){anchors=[];scene.preview([],width);setTool('select');}if(e.code==='Space'){e.preventDefault();pause();}if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}const found=tools.find(t=>t.key===e.key);if(found)setTool(found.id);});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function updateStats(){updateVehicleInspector();const moving=sim.vehicles.filter(v=>v.speed>.5).length;const length=Math.round(world.roads.reduce((total,r)=>total+r.points.slice(1).reduce((s,p,i)=>s+dist(p,r.points[i]),0),0));$('stat-vehicles').innerHTML=`${sim.vehicles.length}<small> phương tiện</small>`;$('stat-roads').innerHTML=`${length.toLocaleString('vi-VN')}<small> m</small>`;$('stat-houses').innerHTML=`${world.houses.filter(h=>{const q=world.nearest(pt(h.x,h.z));return q&&q.distance<26;}).length}<small> ngôi nhà</small>`;$('stat-flow').innerHTML=`${sim.vehicles.length?Math.round(moving/sim.vehicles.length*100):100}<small> % đang chạy</small>`;$('stat-completed').textContent=`${sim.completed} hành trình hoàn thành`;const minutes=Math.floor(sim.time/3)+480;$('sim-time').textContent=`${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
let last=performance.now(),accumulator=0,statsClock=0;
function frame(now:number){const elapsed=Math.min((now-last)/1000,.1);last=now;accumulator+=elapsed*speed;let steps=0;while(accumulator>=1/60&&steps<24){sim.step(1/60);timeline.record();accumulator-=1/60;steps++;}updateTimeline();scene.update(sim,1);if(scene.selectedVehicleId===null&&!$('vehicle-inspector').hidden){clearVehicleSelection();$('directions-legend').hidden=!scene.showDirections;}statsClock+=elapsed;if(statsClock>.5){updateStats();statsClock=0;}requestAnimationFrame(frame);}
updateStats();requestAnimationFrame(frame);
// A read-only snapshot makes automated smoke checks possible without coupling tests to WebGL.
(window as unknown as {__PHO_FLOW__:unknown}).__PHO_FLOW__={snapshot:()=>({vehicles:sim.vehicles.length,roads:world.roads.length,houses:world.houses.length,completed:sim.completed,time:sim.time,paused:sim.paused,drivingSide:world.drivingSide,selectedVehicleId:scene.selectedVehicleId,observationVisible:scene.observationGuide.group.visible,observedVehicleId:scene.observedVehicleId,observations:scene.observations,observationLinkIds:scene.observationLinks.ids,directionVehicleIds:scene.directions.group.visible?scene.directions.group.children.map(g=>Number(g.name.replace('vehicle-direction-',''))):[]}),get world(){return world;},get simulation(){return sim;}};
