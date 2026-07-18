const needle = document.getElementById('needle');
const turboNeedle = document.getElementById('turbo-needle');
const speedDisplay = document.getElementById('speed-val');
const gearDisplay = document.getElementById('gear-val');
const turboBarFill = document.querySelector('.turbo-bar-fill');
const turboImg = document.getElementById('turbo-bar');
let lastTurboDegrees = -1;


let rpm = 0, currentGear = 1, turboCharge = 0, gas = 0, realSpeed = 0;
let steering = 0; // Neu für die Lenkung
let isNosActive = false;
let isStalling = false;
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
    
    let effectiveGas = gas;
    let effectiveNos = (isNosActive && turboCharge > 0) ? 1 : 0;
    
    if (isStalling) {
        effectiveGas = 0.1; // Nur 10% Gas an den echten Motor
        effectiveNos = 0;   // Knallhart: Kein NOS beim Abwürgen!
    }

    // Hier ist der Fix: Wir senden jetzt unsere abgsicherte Variable "effectiveNos"
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
}

function update() {

try {
       // ==========================================
        // SCHALTSCHRANK 1: PHYSIK & RECHNEN
        // ==========================================
        
        let currentSafeGear = Math.max(1, currentGear); 
        let maxSpeedImGang = gearRatios[currentSafeGear] || 300; 
        if (isNosActive && turboCharge > 0) maxSpeedImGang *= 1.15; 

        // 1. UNTERTOURIG / ABWÜRG-LOGIK
        let minSpeed = (currentSafeGear - 1) * 20; 
        let isStalling = (currentSafeGear > 1 && realSpeed < minSpeed);

        // 2. BESCHLEUNIGEN & MOTORBREMSE
        let enginePower = 0;
        let isBoosting = (isNosActive && turboCharge > 0);

        if (realSpeed > maxSpeedImGang + 4) {
            // OVER-REV! (Du hast bei Vollgas brutal runtergeschaltet)
            // Brutale, aber realistische Motorbremse (0.4 statt 2.5 Betonwand)
            realSpeed -= 0.4; 
        } else {
            // NORMALES FAHREN
            if (gas > 0 || isBoosting) {
                if (isStalling) {
                    enginePower = -0.3; // Motor quält sich untertourig
                } else {
                    let effectiveGas = Math.max(gas, isBoosting ? 0.5 : 0);

                    enginePower = (1.5 / currentSafeGear) * gas;
                    if (isNosActive && turboCharge > 0) enginePower *= 2.5;

                    if (isStalling && enginePower > 0) enginePower = -0.8;

                    enginePower = (1.5 / currentSafeGear) * effectiveGas;
                    
                    // NOS gibt den extra Kick
                    if (isBoosting) enginePower *= 2.5;
                }
                
                realSpeed += enginePower;
                
                // DER BEGRENZER: Deckelt die Geschwindigkeit im aktuellen Gang
                // (Das ist der Grund, warum du "stuck" bist -> Du MUSST schalten!)
                if (realSpeed > maxSpeedImGang) {
                    realSpeed = maxSpeedImGang; 
                }
            } else {
                // Fuß vom Gas
                realSpeed -= 0.15; 
            }
        }

        if (realSpeed < 0) realSpeed = 0;

        // 3. DREHZAHL BERECHNEN (Jetzt mit perfektem Nadel-Verhalten)
        let rpmZiel = 900; 

        if (realSpeed > maxSpeedImGang + 2) {
            // MOTOR SCHREIT (Runterschalten bei 200 km/h)
            rpmZiel = 9500 + (Math.random() * 200); 
        } else if (isStalling && gas > 0) {
            // MOTOR HUSTET (Abwürgen)
            rpmZiel = 800 + (Math.random() * 200); 
        } else {
            // NORMALER VORTRIEB
            rpmZiel = (realSpeed / maxSpeedImGang) * 9000;
            
            // BEGRENZER-BOUNCING: Nadel stottert bei 9000 Touren (Brap-brap-brap)
            if (realSpeed >= maxSpeedImGang && gas > 0 && currentSafeGear < 6) {
                rpmZiel = 8900 + (Math.random() * 200); 
            }
        }

        // Schwungrad-Effekt: Macht die Nadel butterweich
        rpm += (rpmZiel - rpm) * 0.3; 
        
        if (rpm < 900) rpm = 900; // Standgas-Boden
        let jitter = (rpm > 8500) ? (Math.random() - 0.5) * 20 : 0;

        // --- 4. NOS / Flaschen-Logik ---
        if (isNosActive && turboCharge > 0) {
            turboCharge -= 1.0; 
        } else {
            let chargeRate = 0.035; 
            if (gas > 0.8 && Math.abs(steering) > 0.5 && !isStalling) {
                chargeRate = 0.3; 
            }
            turboCharge = Math.min(turboCharge + chargeRate, 100);
        }
        
        // --- 5. Ladedruck-Logik ---
        let targetBoostAngle = 0;
        if (gas > 0.1 && !isStalling && realSpeed <= maxSpeedImGang + 2) {
            if (rpm < 2800) {
                targetBoostAngle = -45; // Turboloch
            } else {
                targetBoostAngle = (rpm / 9000) * 90 * gas; 
            }
        }
        if (isNosActive && turboCharge > 0) targetBoostAngle += 30;
        targetBoostAngle = Math.max(-60, Math.min(47, targetBoostAngle)); 

        let currentTurboAngle = parseFloat(turboNeedle.dataset.angle || 0);
        currentTurboAngle += (targetBoostAngle - currentTurboAngle) * 0.1; 
        turboNeedle.dataset.angle = currentTurboAngle;
    // Update auf das Bild (Achtung: Hier deine korrekten CSS-Translate Werte nehmen!)


        // ==========================================
        // SCHALTSCHRANK 2: GRAFIK AUFS DISPLAY BRINGEN
        // ==========================================

    // A. RPM Nadel
    let safeRpm = Math.max(900, Math.min(rpm, 9000));
    let angle = -95 + (rpm / 9000) * 156;
    needle.style.transform = `translate(-50%, -82%) rotate(${angle + jitter}deg)`;

    // B. Turbo Nadel(mechanisch)
    if(turboNeedle) {
        turboNeedle.style.transform = `translate(-50%, -0%) rotate(${currentTurboAngle}deg)`;
    }

    // C. Turbo Bar (grafisch)
    let turboDegrees = Math.floor((turboCharge / 100) * 180);
    // 2. NUR Zeichnen, wenn sich der Wert geändert hat
    if (turboDegrees !== lastTurboDegrees) {
    // So polst du den Gradienten um (füllt gegen den Uhrzeigersinn) 230° ist die Startposition, 360° ist das Ende:
        turboBarFill.style.background = `conic-gradient(from 230deg, transparent ${360 - turboDegrees}deg, rgba(255, 255, 0, 0.8) ${360 - turboDegrees}deg)`;
        lastTurboDegrees = turboDegrees; // Wert speichern
    }

    // NEUER CODE FÜR DIE GRAUEN NULLEN:
    let speedStr = Math.floor(realSpeed).toString();
    if (speedStr.length === 1) {
    // 1-stellig (z.B. "5"): Macht "00" blass und die "5" normal
        speedDisplay.innerHTML = `<span style="opacity: 0.25;">00</span>${speedStr}`;
    } else if (speedStr.length === 2) {
    // 2-stellig (z.B. "45"): Macht "0" blass und "45" normal
        speedDisplay.innerHTML = `<span style="opacity: 0.25;">0</span>${speedStr}`;
    } else {
    // 3-stellig (z.B. "120"): Alles normal
        speedDisplay.innerHTML = speedStr;
    }
}
    catch (fehler) {
        // Der Touch-Retter
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
        } else if (elem.webkitRequestFullscreen) { /* Safari / iOS spezifisch */
            elem.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari / iOS spezifisch */
            document.webkitExitFullscreen();
        }
    }
});