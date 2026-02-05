import network
sta = network.WLAN(network.STA_IF)
ap = network.WLAN(network.AP_IF)
print("STA:", sta.active(), sta.isconnected(), sta.ifconfig())
print("AP :", ap.active(), ap.isconnected(), ap.ifconfig())
