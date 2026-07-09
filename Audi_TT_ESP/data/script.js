const needle = document.getElementById('needle');
const turboNeedle = document.getElementById('turbo-needle');
const speedDisplay = document.getElementById('speed-val');
const gearDisplay = document.getElementById('gear-val');

let rpm = 0, currentGear = 1, turboCharge = 0, gas = 0, realSpeed = 0;
let steering = 0; // Neu für die Lenkung
let isNosActive = false;
const gearRatios = [0, 50, 95, 140, 190, 245, 320];

let activeTouches = {};
let lastSentGas = -1;
let lastSentSteer = -1; // Neu für Drosselung
let sendTimeout = false;

window.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        let target = t.target;

        if (target.id === 'gear-up') { shiftGear('up'); activeTouches[t.identifier] = 'btn'; }
        else if (target.id === 'gear-down') { shiftGear('down'); activeTouches[t.identifier] = 'btn'; }
        else if (target.id === 'nos-btn') { isNosActive = true; activeTouches[t.identifier] = 'nos'; sendToESP(); }
        else { 
            // Bildschirm in zwei Hälften teilen
            if (t.clientX < window.innerWidth / 2) {
                // Linke Seite: Lenken
                activeTouches[t.identifier] = { type: 'steer' };
            } else {
                // Rechte Seite: Gas
                activeTouches[t.identifier] = { type: 'gas', startY: t.clientY };
            }
        }
    }
}, {passive: false});

window.addEventListener('touchmove', (e) => {
    if (e.cancelable) e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        let data = activeTouches[t.identifier];

        if (data && data.type === 'gas') {
            let weg = data.startY - t.clientY;
            let targetGas = weg > 0 ? Math.min(weg / 150, 1) : 0;
            gas += (targetGas - gas) * 0.3; 
            sendToESP();
        } 
        else if (data && data.type === 'steer') {
            // Lenkung berechnen: Mitte der linken Seite (Breite/4) als Nullpunkt
            let centerX = window.innerWidth / 4;
            let range = window.innerWidth / 4;
            steering = (t.clientX - centerX) / range;
            steering = Math.max(-1, Math.min(1, steering)); // Begrenzen auf -1 bis 1
            sendToESP();
        }
    }
}, {passive: false});

window.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        let data = activeTouches[t.identifier];
        if (data === 'nos') { isNosActive = false; sendToESP(); }
        if (data && data.type === 'gas') { gas = 0; sendToESP(); }
        if (data && data.type === 'steer') { steering = 0; sendToESP(); }
        delete activeTouches[t.identifier];
    }
});

function sendToESP() {
    if (sendTimeout) return;
    
    // Sende Gas und Lenkung zusammen
    fetch(`/control?gas=${gas.toFixed(2)}&nos=${isNosActive ? 1 : 0}&steer=${steering.toFixed(2)}`)
        .catch(() => {});
        
    lastSentGas = gas;
    lastSentSteer = steering;
    sendTimeout = true;
    setTimeout(() => { sendTimeout = false; }, 40); 
}

function shiftGear(dir) {
    if (dir === 'up' && currentGear < 6) { currentGear++; rpm *= 0.7; }
    else if (dir === 'down' && currentGear > 1) { currentGear--; rpm = Math.min(rpm * 1.3, 7600); }
    gearDisplay.innerText = currentGear;
}

function update() {
    let rpmZiel = gas * 8000;
    if (isNosActive) rpmZiel = 8500;
    
    rpm += (rpmZiel - rpm) * 0.15;
    
    let jitter = (rpm > 7800) ? (Math.random() - 0.5) * 20 : 0;
    
    let speedZiel = (rpm / 8000) * gearRatios[currentGear];
    if (isNosActive) speedZiel *= 1.2;
    realSpeed += (speedZiel - realSpeed) * 0.08;

    if (isNosActive && turboCharge > 0) turboCharge -= 0.7;
    else if (gas > 0.8) turboCharge = Math.min(turboCharge + 0.3, 100);
    else turboCharge = Math.max(turboCharge - 0.2, 0);

    let angle = -120 + (rpm / 8000) * 240;
    needle.style.transform = `translate(-50%, -82%) rotate(${angle + jitter}deg)`;

    let turboAngle = 50 + (turboCharge * -1.0);
    turboNeedle.style.transform = `translate(-50%, 0) rotate(${turboAngle}deg)`;

    speedDisplay.innerText = Math.floor(realSpeed).toString().padStart(3, '0');
    
    requestAnimationFrame(update);
} 
update();

document.getElementById('fs-trigger').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
});