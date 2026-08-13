from PIL import Image
import os

def restore_square_logo(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    
    # Get bounding box of anything not transparent
    bbox = img.getbbox()
    if bbox:
        # Initial crop to the content
        img = img.crop(bbox)
        
        w, h = img.size
        new_size = max(w, h)
        
        # Create a new square transparent canvas
        new_img = Image.new("RGBA", (new_size, new_size), (255, 255, 255, 0))
        
        # Center the logo on the new square canvas
        offset = ((new_size - w) // 2, (new_size - h) // 2)
        new_img.paste(img, offset, img)
        
        new_img.save(output_path)
        print(f"Restored and squared {input_path} to {output_path}. New size: {new_img.size}")
    else:
        print("Could not find any content in the image.")

if __name__ == "__main__":
    restore_square_logo("d:/projeler/konum-degistirme/app-icon.png", "d:/projeler/konum-degistirme/src/assets/logo.png")
