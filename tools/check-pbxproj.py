#!/usr/bin/env python3
"""Valida a sintaxe (old-style plist) do project.pbxproj e as referências entre objetos."""
import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else 'ios/Croqui.xcodeproj/project.pbxproj'
s = open(path, encoding='utf-8').read()
i = 0
def err(msg): raise SystemExit(f'ERRO em {s[:i].count(chr(10)) + 1}: {msg}: {s[i:i+60]!r}')
def ws():
    global i
    while i < len(s):
        if s[i].isspace(): i += 1
        elif s.startswith('//', i): i = s.index('\n', i) + 1
        elif s.startswith('/*', i): i = s.index('*/', i) + 2
        else: break
UNQ = re.compile(r'[A-Za-z0-9_$+/:.\-]+')
def value():
    global i
    ws()
    c = s[i]
    if c == '{':
        i += 1; d = {}
        while True:
            ws()
            if s[i] == '}': i += 1; return d
            k = value(); ws()
            if s[i] != '=': err('esperava =')
            i += 1; v = value(); ws()
            if s[i] != ';': err('esperava ;')
            i += 1; d[k] = v
    if c == '(':
        i += 1; a = []
        while True:
            ws()
            if s[i] == ')': i += 1; return a
            a.append(value()); ws()
            if s[i] == ',': i += 1
            elif s[i] != ')': err('esperava , ou )')
    if c == '"':
        j = i + 1; out = []
        while s[j] != '"':
            if s[j] == '\\': out.append(s[j:j+2]); j += 2
            else: out.append(s[j]); j += 1
        i = j + 1; return ''.join(out)
    m = UNQ.match(s, i)
    if not m: err('token inválido')
    i = m.end(); return m.group()
root = value()
objs = root['objects']
refs = set(re.findall(r'\b[0-9A-F]{24}\b', s))
missing = refs - set(objs)
if missing: raise SystemExit(f'ERRO: referências sem objeto: {missing}')
print(f'OK: {len(objs)} objetos, raiz {root["rootObject"]}, sintaxe válida')
