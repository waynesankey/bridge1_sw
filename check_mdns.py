import sys, network
print(sys.version)
try:
    import mdns
    print("mdns module: OK", mdns)
except Exception as exc:
    print("mdns module missing:", exc)
network.hostname("preamp")
