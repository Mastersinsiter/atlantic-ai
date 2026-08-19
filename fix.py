import os

files = [
    r'c:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\frontend\public\index.html',
    r'c:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\frontend\public\app.js',
    r'c:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\frontend\public\styles.css'
]
for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # \u00e2\u20ac\u201d is the unicode escape sequence for â€”
    if '\u00e2\u20ac\u201d' in content or 'â€”' in content:
        content = content.replace('\u00e2\u20ac\u201d', '—').replace('â€”', '—')
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Fixed {file}')
