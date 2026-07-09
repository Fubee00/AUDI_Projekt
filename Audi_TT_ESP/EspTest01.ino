#include <WiFi.h>
#include <WebServer.h>
#include "LittleFS.h"
#include <ESP32Servo.h> // NEU: Für das Lenkservo

WebServer server(80);
Servo steeringServo; // NEU: Das Servo-Objekt

// Merker für die Konsole
int lastLogValue = -1;
int centerOffset = 0;

void handleFileRequest() {
  String path = server.uri();
  if (path == "/") path = "/index.html";

  String contentType = "text/plain";
  if (path.endsWith(".html"))      contentType = "text/html";
  else if (path.endsWith(".png"))  contentType = "image/png";
  else if (path.endsWith(".jpg"))  contentType = "image/jpeg";
  else if (path.endsWith(".css"))  contentType = "text/css";
  else if (path.endsWith(".js"))   contentType = "application/javascript";

  if (LittleFS.exists(path)) {
    File file = LittleFS.open(path, "r");
    server.streamFile(file, contentType);
    file.close();
  } else {
    server.send(404, "text/plain", "Datei nicht gefunden");
  }
}

void handleControl() {
  float gasVal = 0;
  float steerVal = 0; // NEU
  bool nosActive = false;

  if (server.hasArg("gas")) gasVal = server.arg("gas").toFloat();
  if (server.hasArg("nos")) nosActive = (server.arg("nos") == "1");
  if (server.hasArg("steer")) steerVal = server.arg("steer").toFloat(); // NEU

  // --- MOTOR LOGIK ---
  int pwmValue = (int)(gasVal * 255);
  if (nosActive) pwmValue = 255;
  if (pwmValue < 20) pwmValue = 0;
  
  analogWrite(D0, pwmValue);
  digitalWrite(D1, LOW); 

  // --- LENK LOGIK (NEU) ---
  // steerVal kommt als -1.0 (links) bis 1.0 (rechts)
  // Wir wandeln das um: -1.0 -> 0 Grad, 0.0 -> 90 Grad, 1.0 -> 180 Grad
  int angle = (int)((steerVal + 1.0) * 90.0) + centerOffset;
  angle = constrain(angle,0,180);
  steeringServo.write(angle); 

  // Konsolen-Log
  if (pwmValue != lastLogValue) {
    Serial.print("Gas: "); Serial.print(gasVal * 100); Serial.print("%");
    Serial.print(" | Lenkung: "); Serial.println(steerVal);
    lastLogValue = pwmValue;
  }

  server.send(200, "text/plain", "OK");
}

void setup() {
  Serial.begin(115200);
  delay(1000); 
  
  pinMode(D0, OUTPUT);
  pinMode(D1, OUTPUT);
  
  // Servo an Pin D2 anschließen
  steeringServo.attach(D2); 

  WiFi.softAP("Audi_S3_Remote", "nfs12345");
  
  if (!LittleFS.begin()) {
    Serial.println("!!! LittleFS Error !!!");
  }

  server.on("/control", HTTP_GET, handleControl);
  server.onNotFound(handleFileRequest);

  server.begin();
  Serial.println("SYSTEM READY - LENKUNG AKTIVIERT");
}

void loop() {
  server.handleClient();
}