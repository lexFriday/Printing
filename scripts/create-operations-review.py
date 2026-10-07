from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('NJL_operations_visual_review')
ROOT.mkdir(exist_ok=True)
font = ImageFont.load_default()
shots = {
    'Calendar': Path(r'C:\Users\skhart\AppData\Local\Temp\codex-clipboard-b6d96ae9-1534-4ff5-b6dd-50923a63e742.png'),
    'Inventory': Path(r'C:\Users\skhart\AppData\Local\Temp\codex-clipboard-be3abc17-9766-45a7-a17d-90ee45707853.png'),
    'Purchasing': Path(r'C:\Users\skhart\AppData\Local\Temp\codex-clipboard-df79d7c6-c4c8-4b03-ba54-e07fff376090.png'),
    'Production / BOM': Path(r'C:\Users\skhart\AppData\Local\Temp\codex-clipboard-dcbf21b5-9269-4431-839d-0053e0c75345.png'),
}
notes = {
    'Calendar': ('Calendar is Job Order-linked', 'Selected date shows status, customer, target completion, and Open Job Order.', 'Add blocker/next-action text beside the date card.'),
    'Inventory': ('Balance list -> operational view', 'Reorder warnings, linked jobs, movement context.', 'Add one clear Open material action.'),
    'Purchasing': ('Requests now show progress', 'Supplier, remaining quantity, receipt progress, job link.', 'Make the status action dominant.'),
    'Production / BOM': ('BOM templates are editable', 'Versioned sample recipe and demo-data warning.', 'Move users into the Job Order context before release.'),
}
html = ['<!doctype html><meta charset="utf-8"><title>NJL Operations visual review</title><style>body{font:16px Arial;color:#0f172a;background:#f7f9fc;max-width:1100px;margin:32px auto}section{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:20px 0}img{max-width:100%;border:1px solid #cbd5e1;border-radius:8px}.note{background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-top:12px}.muted{color:#64748b}</style><h1>NJL Operations visual review</h1><p class="muted">Annotated prototype review • Ponytail: one next action, no duplicate workflow state.</p>']
for title, path in shots.items():
    im = Image.open(path).convert('RGB'); draw = ImageDraw.Draw(im)
    changed, added, improve = notes[title]
    x, y, w, h = max(10, im.width-390), 18, 370, 72
    draw.rounded_rectangle((x,y,x+w,y+h), radius=10, fill='#fff7cc', outline='#f59e0b', width=2)
    draw.text((x+12,y+10), changed, fill='#78350f', font=font)
    draw.text((x+12,y+28), added, fill='#78350f', font=font)
    draw.text((x+12,y+46), 'Improve: '+improve, fill='#78350f', font=font)
    out = ROOT / (title.lower().replace(' / ','-').replace(' ','-') + '.png'); im.save(out)
    html += [f'<section><h2>{title}</h2><img src="{out.name}"><div class="note"><b>What changed:</b> {changed}<br><b>What was added:</b> {added}<br><b>Smallest improvement:</b> {improve}</div></section>']
(ROOT/'index.html').write_text('\n'.join(html), encoding='utf-8')
print((ROOT/'index.html').resolve())
