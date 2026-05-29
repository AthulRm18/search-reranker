import os
from PIL import Image, ImageDraw

def create_icon(size_px):
    w = h = size_px
    # Create transparent image
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Define coordinate system based on size
    # Pad from outer boundaries
    pad_x = w * 0.12
    pad_y = w * 0.12
    
    # Width of each arrow
    arrow_w = w * 0.34
    # Shaft width (thickness)
    shaft_w = arrow_w * 0.44
    
    # Arrow head height (triangle height)
    head_h = (h - 2 * pad_y) * 0.40
    
    # --- UP ARROW (Left) ---
    cx1 = pad_x + arrow_w / 2
    y_top1 = pad_y
    y_bottom1 = h - pad_y
    
    up_head = [
        (cx1, y_top1),
        (cx1 - arrow_w / 2, y_top1 + head_h),
        (cx1 + arrow_w / 2, y_top1 + head_h)
    ]
    up_shaft = [
        (cx1 - shaft_w / 2, y_top1 + head_h - 1),  # tiny overlap to prevent gap lines
        (cx1 + shaft_w / 2, y_bottom1)
    ]
    
    # --- DOWN ARROW (Right) ---
    cx2 = w - pad_x - arrow_w / 2
    y_top2 = pad_y
    y_bottom2 = h - pad_y
    
    down_head = [
        (cx2, y_bottom2),
        (cx2 - arrow_w / 2, y_bottom2 - head_h),
        (cx2 + arrow_w / 2, y_bottom2 - head_h)
    ]
    down_shaft = [
        (cx2 - shaft_w / 2, y_top2),
        (cx2 + shaft_w / 2, y_bottom2 - head_h + 1)
    ]
    
    # Pure black color
    black_color = (0, 0, 0, 255)
    
    # Draw Up Arrow
    draw.polygon(up_head, fill=black_color)
    draw.rectangle(up_shaft, fill=black_color)
    
    # Draw Down Arrow
    draw.polygon(down_head, fill=black_color)
    draw.rectangle(down_shaft, fill=black_color)
    
    return img

def main():
    icons_dir = r"c:\Users\ATHUL\Desktop\Search ReRank\extension\icons"
    os.makedirs(icons_dir, exist_ok=True)
    
    sizes = [16, 48, 128]
    for size in sizes:
        img = create_icon(size)
        path = os.path.join(icons_dir, f"icon{size}.png")
        img.save(path, "PNG")
        print(f"Generated {size}x{size} icon at: {path}")

if __name__ == "__main__":
    main()
