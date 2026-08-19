"""
Direct byte-level fix for remaining mojibake in frontend files.
"""

files = [
    r'c:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\frontend\public\index.html',
    r'c:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\frontend\public\app.js',
    r'c:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\frontend\public\styles.css',
]

replacements = [
    # New ones found via grep:
    (b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9c', '─'.encode('utf-8')),
    (b'\xc3\xa2\xe2\x80\x9d\xe2\x82\xac', '─'.encode('utf-8')),
    (b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x94', '─'.encode('utf-8')),
    
    # Emojis/Symbols
    (b'\xc3\xa2\xc5\xa1\xe2\x80\x99', '🔨'.encode('utf-8')),    # âš’ -> 🔨
    (b'\xc3\xa2\xe2\x86\x93', '↓'.encode('utf-8')),          # â†“ -> ↓
    (b'\xc3\xa2\xe2\x80\x93\xc2\xb6', '▶'.encode('utf-8')),  # â–¶ -> ▶
    (b'\xc3\xa2\xe2\x80\x94\x8e', '◎'.encode('utf-8')),      # â—Ž -> ◎
    (b'\xc3\xa2\x80\x9c\x85', '✅'.encode('utf-8')),
    (b'\xc3\xa2\xc5\x93\x95', '✕'.encode('utf-8')),          # âœ• -> ✕
    (b'\xc3\xa2\xc5\x93\x82\xef\xb8\x8f', '✂️'.encode('utf-8')), # âœ‚️ -> ✂️
    (b'\xc3\xa2\xc5\x93\xa8', '✨'.encode('utf-8')),          # âœ¨ -> ✨
    (b'\xc3\xa2\xc5\x93\x85', '✅'.encode('utf-8')),          # âœ… -> ✅
    (b'\xc3\xa2\x81\x8c', '❌'.encode('utf-8')),              # â Œ -> ❌
    (b'\xc3\xa2\xc2\xac\xe2\x80\xa1', '⬇'.encode('utf-8')),  # â¬‡ -> ⬇
    (b'\xc3\xa2\xc5\x93\x8f\xef\xb8\x8f', '✏️'.encode('utf-8')), # âœ ️ -> ✏️
    
    # Comments borders
    (b'\xc3\xa2\xe2\x80\xa2', '─'.encode('utf-8')),
    
    # Simple double-encoded
    (b'\xc3\xa2\xe2\x80\x9c', '─'.encode('utf-8')),
    (b'\xc3\xa2\xe2\x82\xac\xc2\xa2', '•'.encode('utf-8')),
    
    # Other leftovers
    (b'\xc3\xa2\xe2\x80\x9d', '─'.encode('utf-8')),
]

for filepath in files:
    with open(filepath, 'rb') as f:
        data = f.read()
    
    original_len = len(data)
    for bad, good in replacements:
        data = data.replace(bad, good)
    
    with open(filepath, 'wb') as f:
        f.write(data)
    
    diff = original_len - len(data)
    print(f'{filepath.split(chr(92))[-1]}: {diff} bytes fixed')

print('Done!')
