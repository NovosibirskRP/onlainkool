// Для общего бронирования на разных устройствах заполните эти две настройки.
// Если оставить как есть, сайт будет работать в демо-режиме в этом браузере.
const SUPABASE_URL = "https://fjndxzblhhklmichckka.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Af780eCTmG38Q3VK6JWFFw_ORNS-ihH";
const TABLE = "bus_seats";

const $ = (id) => document.getElementById(id);
const seatGrid = $("seatGrid");
const bookingForm = $("bookingForm");
const nameInput = $("passengerName");
const message = $("message");
let db = null;
let selected = null;
let bookings = new Map();
const LOCAL_KEY = "bus-seat-bookings-v2";

// Позиции повторяют план с изображения: две пары слева, две пары справа,
// туалет в правом блоке и три места в последнем ряду.
const leftPairs = [
  [1,2],[5,6],[9,10],[13,14],[17,18],
  [21,22],[23,24],[25,26],[29,30],[33,34],
  [37,38],[41,42],[45,46],[49,50],[53,54]
];
const rightPairs = [
  {row:1,pair:[3,4]},{row:2,pair:[7,8]},{row:3,pair:[11,12]},
  {row:4,pair:[15,16]},{row:5,pair:[19,20]},
  {row:8,pair:[27,28]},{row:9,pair:[31,32]},{row:10,pair:[35,36]},
  {row:11,pair:[39,40]},{row:12,pair:[43,44]},{row:13,pair:[47,48]},
  {row:14,pair:[51,52]}
];
const seats = [];
leftPairs.forEach((pair,i)=>pair.forEach((num,j)=>seats.push({num,row:i+1,col:j+1})));
rightPairs.forEach(({row,pair})=>pair.forEach((num,j)=>seats.push({num,row,col:6+j})));
[55,56,57].forEach((num,i)=>seats.push({num,row:16,col:3+i}));

function addFeature(label,row,colStart,colEnd=colStart){
  const el=document.createElement("div");
  el.className="feature";el.textContent=label;
  el.style.gridRow=String(row);el.style.gridColumn=`${colStart} / ${colEnd+1}`;
  seatGrid.appendChild(el);
}
function draw(){
  seatGrid.innerHTML="";
  addFeature("TV",1,4);
  addFeature("ТУАЛЕТ",6,6,7);
  addFeature("TV",15,4);
  seats.forEach(s=>{
    const b=document.createElement("button");
    b.type="button";b.className="seat";b.textContent=s.num;
    b.style.gridRow=String(s.row);b.style.gridColumn=String(s.col);
    b.dataset.num=s.num;b.addEventListener("click",()=>choose(s.num));
    seatGrid.appendChild(b);
  });
  paint();
}
function paint(){
  seatGrid.querySelectorAll(".seat").forEach(b=>{
    const num=Number(b.dataset.num),who=bookings.get(num);
    b.classList.toggle("busy",!!who);
    b.classList.toggle("selected",num===selected);
    b.title=who?`Место ${num} занято: ${who}`:`Свободное место ${num}`;
    b.setAttribute("aria-label",b.title);
  });
  const busy=bookings.size,free=seats.length-busy;
  $("freeCount").textContent=free;$("totalCount").textContent=seats.length;
  $("busyCount").textContent=`${busy} занято`;
  $("percent").textContent=`${Math.round(free/seats.length*100)}% свободно`;
  $("barFill").style.width=`${busy/seats.length*100}%`;
}
function choose(num){
  selected=num;message.textContent="";message.style.color="";
  const who=bookings.get(num);
  $("selectedNumber").textContent=String(num);
  if(who){
    $("selectionTitle").textContent="Место уже занято";
    $("selectionText").textContent="Это место выбрал другой пассажир.";
    $("occupiedPanel").hidden=false;$("occupiedName").textContent=`Занято: ${who}`;
    bookingForm.hidden=true;
  }else{
    $("selectionTitle").textContent="Место свободно!";
    $("selectionText").textContent="Введи имя пассажира и нажми «Занять это место».";
    $("occupiedPanel").hidden=true;bookingForm.hidden=false;
    nameInput.value="";nameInput.focus();
  }
  paint();
}
function localLoad(){
  try{
    const raw=JSON.parse(localStorage.getItem(LOCAL_KEY)||"{}");
    bookings=new Map(Object.entries(raw).map(([n,name])=>[Number(n),name]));
  }catch{bookings=new Map();}
  paint();
}
function localSave(){
  localStorage.setItem(LOCAL_KEY,JSON.stringify(Object.fromEntries(bookings)));
}
async function refreshCloud(){
  const {data,error}=await db.from(TABLE).select("seat_number, passenger_name");
  if(error)throw error;
  bookings=new Map((data||[]).map(x=>[x.seat_number,x.passenger_name]));
  paint();
  if(selected!==null && bookings.has(selected)) choose(selected);
}
bookingForm.addEventListener("submit",async e=>{
  e.preventDefault();
  if(selected===null)return;
  const name=nameInput.value.trim();
  if(!name){message.textContent="Напиши имя пассажира.";return;}
  if(bookings.has(selected)){choose(selected);return;}
  const btn=$("reserveButton");btn.disabled=true;btn.textContent="Сохраняем…";
  try{
    if(db){
      const {error}=await db.from(TABLE).insert({seat_number:selected,passenger_name:name});
      if(error){
        if(error.code==="23505"){await refreshCloud();choose(selected);message.textContent="Это место только что заняли. Выбери другое.";}
        else throw error;
        return;
      }
      await refreshCloud();
    }else{
      bookings.set(selected,name);localSave();paint();
    }
    $("selectionTitle").textContent="Место успешно занято!";
    $("selectionText").textContent="Бронирование сохранено.";
    bookingForm.hidden=true;$("occupiedPanel").hidden=false;
    $("occupiedName").textContent=`Пассажир: ${name}`;
    $("occupiedPanel").style.background="#e8f8f1";
    $("occupiedPanel").style.color="#137b58";
    $("occupiedPanel").querySelector(".occupied-mark").textContent="✓";
    $("occupiedPanel").querySelector(".occupied-mark").style.background="#18a878";
    message.style.color="#18a878";message.textContent="Готово! Место отмечено как занятое.";
  }catch(err){
    console.error(err);message.textContent="Не удалось сохранить бронь. Проверь подключение Supabase.";
  }finally{btn.disabled=false;btn.innerHTML='Занять это место <span>→</span>';}
});
async function init(){
  draw();localLoad();
  const configured=!SUPABASE_URL.includes("YOUR-PROJECT")&&!SUPABASE_ANON_KEY.includes("YOUR_");
  if(!configured){
    $("connection").classList.add("online");
    $("connection").querySelector("span").textContent="Демо-режим · данные в этом браузере";
    return;
  }
  try{
    db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    await refreshCloud();
    $("connection").classList.add("online");
    $("connection").querySelector("span").textContent="Онлайн · Supabase";
    db.channel("bus-seats-live").on("postgres_changes",{event:"*",schema:"public",table:TABLE},refreshCloud).subscribe();
  }catch(err){
    console.error(err);$("connection").classList.add("error");
    $("connection").querySelector("span").textContent="Нет связи с базой";
  }
}
init();
