# Preamp Wi-Fi Setup

Use these steps to connect the preamp bridge to your home Wi-Fi network.

## 1. Power On the Bridge

1. Power the Pico/preamp bridge.
2. Wait for AP mode logs (or about 10-20 seconds after boot).

## 2. Join the Setup Access Point

1. On your laptop/phone, disconnect from your normal home SSID.
2. Connect to:
   - SSID: `preamp-bridge`
   - Password: `preamp123`
3. Open a browser to the AP setup page:
   - `http://192.168.4.1`

## 3. Enter Home Wi-Fi Credentials

1. In the setup page, enter your normal/home Wi-Fi SSID and password.
2. Click **Update & Connect**.
3. Wait for status to show connected and a clickable IP address.

## 4. Switch Back to Home Wi-Fi

1. Click the displayed IP link.
2. Switch your device back to your home SSID.
3. Reload the displayed IP in your browser if required.

## 5. Verify

1. Confirm the UI loads from the home-network IP.
2. Optional: reserve that IP in your router (DHCP reservation) so it stays stable.

## Troubleshooting

- Stuck on `Connecting to Wi-Fi...`:
  - Re-check SSID/password (case-sensitive).
  - Confirm your home Wi-Fi is 2.4 GHz compatible for Pico W.
- Setup page does not open:
  - Verify you are connected to `preamp-bridge` (not your normal SSID).
  - Try `http://192.168.4.1` explicitly (not HTTPS).
- Connected but cannot find device later:
  - Check router client list for the bridge IP.
  - Use a DHCP reservation.

## Developer Capability

- Copy wifi_template.json, change name to wifi.json, edit SSID and password, upload to pico.
- Log into WiFi router to find IP address used and type that into browser.
- Use a DHCP reservation.
