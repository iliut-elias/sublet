#!/usr/bin/env bash
# Schreibt jede Hook-Payload als eine Zeile in probe/events.jsonl
dir="$(dirname "$0")"
payload="$(cat)"
printf '%s\n' "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.stringify(JSON.parse(s))+"\n")}catch{process.stdout.write(JSON.stringify({raw:s})+"\n")}})' >> "$dir/events.jsonl"
exit 0
