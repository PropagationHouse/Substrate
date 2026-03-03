#!/bin/bash 
echo \"Starting XGO audio receiver...\" 
cd /root 
python3 -c \"import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.bind(('0.0.0.0',12345)); print('UDP server listening on port 12345'); while True: data,addr=s.recvfrom(1024); print(f'Received {len(data)} bytes from {addr}');\" 
