const needle = document.getElementById('needle');
const turboNeedle = document.getElementById('turbo-needle');
const speedDisplay = document.getElementById('speed-val');
const gearDisplay = document.getElementById('gear-val');
const turboBarFill = document.querySelector('.turbo-bar-fill');
const turboImg = document.getElementById('turbo-bar');
let lastTurboDegrees = -1;

let rpm = 0, currentGear = 1, turboCharge = 0, gas = 0, realSpeed = 0;
let steering = 0; 
let isNosActive = false;
let isStalling = false;
const gearRatios = [0, 50, 95, 140, 190, 245, 320];

let activeTouches = {};
let lastSentGas = -1;
let lastSentSteer = -1; 
let sendTimeout = false;

window.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        let target = t.target;

        if (target.id === 'nos-btn') { 
            isNosActive = true; 
            activeTouches[t.identifier] = 'nos'; 
            sendToESP(); 
        } 
        else { 
            if (t.clientX < window.innerWidth / 2) {
                activeTouches[t.identifier] = { type: 'steer', startY: t.clientY };
            } else {
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
            let centerX = window.innerWidth / 4;
            let range = window.innerWidth / 4;
            steering = (t.clientX - centerX) / range;
            steering = Math.max(-1, Math.min(1, steering));
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
        
        if (data && data.type === 'steer') { 
            let endY = t.clientY;
            let deltaY = data.startY - endY; 
            const swipeThreshold = 60;

            if (deltaY > swipeThreshold) {
                shiftGear('up');
            } 
            else if (deltaY < -swipeThreshold) {
                shiftGear('down');
            }

            steering = 0; 
            sendToESP(); 
        }
        
        delete activeTouches[t.identifier];
    }
});

function sendToESP() {
    if (sendTimeout) return;
    
    let effectiveGas = gas;
    let effectiveNos = (isNosActive && turboCharge > 0) ? 1 : 0;
    
    if (isStalling) {
        effectiveGas = 0.1; 
        effectiveNos = 0; 
    }

    fetch(`/control?gas=${effectiveGas.toFixed(2)}&nos=${effectiveNos}&steer=${steering.toFixed(2)}`)
        .catch(() => {});
        
    lastSentGas = effectiveGas;
    lastSentSteer = steering;
    sendTimeout = true;
    setTimeout(() => { sendTimeout = false; }, 40);
}

function shiftGear(dir) {
    if (dir === 'up' && currentGear < 6) { currentGear++; rpm *= 0.7; }
    else if (dir === 'down' && currentGear > 1) { currentGear--; rpm = Math.min(rpm * 1.3, 7600); }
    
    gearDisplay.innerText = currentGear;
    
    // Feintuning für die 1, damit sie exakt im Segment sitzt
    if (currentGear === 1) {
        gearDisplay.style.transform = "translateX(2px)"; 
    } else {
        gearDisplay.style.transform = "none";
    }
}

// Direkt beim Start initialisieren:
gearDisplay.innerText = currentGear;
gearDisplay.style.transform = (currentGear === 1) ? "translateX(2px)" : "none";

function update() {
    try {
        let currentSafeGear = Math.max(1, currentGear); 
        let maxSpeedImGang = gearRatios[currentSafeGear] || 300; 
        if (isNosActive && turboCharge > 0) maxSpeedImGang *= 1.15; 

        let minSpeed = (currentSafeGear - 1) * 20; 
        let isStalling = (currentSafeGear > 1 && realSpeed < minSpeed);

        let enginePower = 0;
        let isBoosting = (isNosActive && turboCharge > 0);

        if (realSpeed > maxSpeedImGang + 4) {
            realSpeed -= 0.4; 
        } else {
            if (gas > 0 || isBoosting) {
                if (isStalling) {
                    enginePower = -0.3; 
                } else {
                    let effectiveGas = Math.max(gas, isBoosting ? 0.5 : 0);
                    enginePower = (1.5 / currentSafeGear) * effectiveGas;
                    if (isBoosting) enginePower *= 2.5;
                }
                realSpeed += enginePower;
                if (realSpeed > maxSpeedImGang) {
                    realSpeed = maxSpeedImGang; 
                }
            } else {
                realSpeed -= 0.15; 
            }
        }

        if (realSpeed < 0) realSpeed = 0;

        let rpmZiel = 900; 
        if (realSpeed > maxSpeedImGang + 2) {
            rpmZiel = 9500 + (Math.random() * 200); 
        } else if (isStalling && gas > 0) {
            rpmZiel = 800 + (Math.random() * 200); 
        } else {
            rpmZiel = (realSpeed / maxSpeedImGang) * 9000;
            if (realSpeed >= maxSpeedImGang && gas > 0 && currentSafeGear < 6) {
                rpmZiel = 8900 + (Math.random() * 200); 
            }
        }

        rpm += (rpmZiel - rpm) * 0.3; 
        if (rpm < 900) rpm = 900; 
        let jitter = (rpm > 8500) ? (Math.random() - 0.5) * 20 : 0;

        if (isNosActive && turboCharge > 0) {
            turboCharge -= 1.0; 
        } else {
            let chargeRate = 0.035; 
            if (gas > 0.8 && Math.abs(steering) > 0.5 && !isStalling) {
                chargeRate = 0.3; 
            }
            turboCharge = Math.min(turboCharge + chargeRate, 100);
        }
        
        let targetBoostAngle = 0;
        if (gas > 0.1 && !isStalling && realSpeed <= maxSpeedImGang + 2) {
            if (rpm < 2800) {
                targetBoostAngle = -45; 
            } else {
                targetBoostAngle = (rpm / 9000) * 90 * gas; 
            }
        }
        if (isNosActive && turboCharge > 0) targetBoostAngle += 30;
        targetBoostAngle = Math.max(-60, Math.min(47, targetBoostAngle)); 

        let currentTurboAngle = parseFloat(turboNeedle.dataset.angle || 0);
        currentTurboAngle += (targetBoostAngle - currentTurboAngle) * 0.1; 
        turboNeedle.dataset.angle = currentTurboAngle;

        let safeRpm = Math.max(900, Math.min(rpm, 9000));
        let angle = -95 + (rpm / 9000) * 156;
        needle.style.transform = `translate(-50%, -82%) rotate(${angle + jitter}deg)`;

        if(turboNeedle) {
            turboNeedle.style.transform = `translate(-50%, -0%) rotate(${currentTurboAngle}deg)`;
        }

        let turboDegrees = Math.floor((turboCharge / 100) * 180);
        if (turboDegrees !== lastTurboDegrees) {
            turboBarFill.style.background = `conic-gradient(from 230deg, transparent ${360 - turboDegrees}deg, #fbc072 ${360 - turboDegrees}deg)`;
            lastTurboDegrees = turboDegrees; 
        }

        let speedStr = Math.floor(realSpeed).toString();
        if (speedStr.length === 1) {
            speedDisplay.innerHTML = `<span style="opacity: 0.25;">00</span>${speedStr}`;
        } else if (speedStr.length === 2) {
            speedDisplay.innerHTML = `<span style="opacity: 0.25;">0</span>${speedStr}`;
        } else {
            speedDisplay.innerHTML = speedStr;
        }
    }
    catch (fehler) {
        console.error("Kabelbrand im Code:", fehler);
    }

    requestAnimationFrame(update);
} 
update();

document.getElementById('fs-trigger').addEventListener('click', () => {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) { 
            elem.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { 
            document.webkitExitFullscreen();
        }
    }
});