from pathlib import Path
from PIL import Image, ImageDraw

SOURCE = Path(r"C:\projects\MetaWorks\.tmp\manual_render3")
OUTPUT = Path(r"C:\projects\MetaWorks\.tmp\manual_review")
OUTPUT.mkdir(parents=True, exist_ok=True)

pages = sorted(SOURCE.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[1]))

# Overview sheets show six complete pages at a time.
for sheet_no, start in enumerate(range(0, len(pages), 6), 1):
    selected = pages[start:start + 6]
    thumb_w, thumb_h = 250, 323
    sheet = Image.new("RGB", (thumb_w * 3 + 40, thumb_h * 2 + 70), "#D7DCE2")
    draw = ImageDraw.Draw(sheet)
    for idx, path in enumerate(selected):
        with Image.open(path) as source:
            page = source.convert("RGB")
            page.thumbnail((thumb_w - 12, thumb_h - 28), Image.Resampling.LANCZOS)
            x = 10 + (idx % 3) * thumb_w + (thumb_w - page.width) // 2
            y = 10 + (idx // 3) * thumb_h + 18
            sheet.paste(page, (x, y))
            draw.text((10 + (idx % 3) * thumb_w, 10 + (idx // 3) * thumb_h), path.stem, fill="#111827")
    out = OUTPUT / f"overview-{sheet_no}.jpg"
    sheet.save(out, "JPEG", quality=34, optimize=True)

# Each page is also split into top and bottom review images. These preserve enough
# detail for reading while keeping each image small enough for the review channel.
for path in pages:
    with Image.open(path) as source:
        page = source.convert("L")
        width, height = page.size
        overlap = 90
        regions = {
            "top": (0, 0, width, min(height, height // 2 + overlap)),
            "bottom": (0, max(0, height // 2 - overlap), width, height),
        }
        for label, box in regions.items():
            piece = page.crop(box)
            target_w = 760
            target_h = round(piece.height * target_w / piece.width)
            piece = piece.resize((target_w, target_h), Image.Resampling.LANCZOS)
            out = OUTPUT / f"{path.stem}-{label}.jpg"
            quality = 46
            piece.save(out, "JPEG", quality=quality, optimize=True)
            while out.stat().st_size > 28500 and quality > 18:
                quality -= 4
                piece.save(out, "JPEG", quality=quality, optimize=True)

print(f"pages={len(pages)} overviews={(len(pages) + 5) // 6} review_images={len(pages) * 2}")
