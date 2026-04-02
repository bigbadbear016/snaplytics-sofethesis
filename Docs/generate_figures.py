from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
W, H = 2000, 1200


PALETTE = {
    "bg": "#F8FAFC",
    "panel": "#EEF4FF",
    "panel_border": "#3F5FA6",
    "entity": "#FFF5E8",
    "entity_border": "#C67A1D",
    "store": "#EBF9EE",
    "store_border": "#2D8A4A",
    "text": "#102447",
    "muted": "#405A84",
    "line": "#2B4C86",
    "shadow": "#DCE6F7",
}


def font(size: int):
    for name in ("segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_center_text(draw, box, text, size=24, color=None):
    x1, y1, x2, y2 = box
    fnt = font(size)
    lines = text.split("\n")
    line_h = draw.textbbox((0, 0), "Hg", font=fnt)[3]
    total_h = len(lines) * line_h + (len(lines) - 1) * 5
    y = y1 + (y2 - y1 - total_h) / 2
    for line in lines:
        line_w = draw.textbbox((0, 0), line, font=fnt)[2]
        x = x1 + (x2 - x1 - line_w) / 2
        draw.text((x, y), line, font=fnt, fill=color or PALETTE["text"])
        y += line_h + 5


def card(draw, box, text, kind="panel", size=24):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1 + 6, y1 + 6, x2 + 6, y2 + 6), radius=16, fill=PALETTE["shadow"])
    fill = PALETTE[kind]
    border = PALETTE[f"{kind}_border"]
    draw.rounded_rectangle(box, radius=16, fill=fill, outline=border, width=3)
    draw_center_text(draw, box, text, size=size)


def arrow(draw, p1, p2, color=None, width=4):
    color = color or PALETTE["line"]
    draw.line([p1, p2], fill=color, width=width)
    x1, y1 = p1
    x2, y2 = p2
    dx, dy = x2 - x1, y2 - y1
    mag = (dx**2 + dy**2) ** 0.5 or 1
    ux, uy = dx / mag, dy / mag
    px, py = -uy, ux
    s = 16
    tip = (x2, y2)
    left = (x2 - ux * s - px * s * 0.65, y2 - uy * s - py * s * 0.65)
    right = (x2 - ux * s + px * s * 0.65, y2 - uy * s + py * s * 0.65)
    draw.polygon([tip, left, right], fill=color)


def note(draw, at, text, size=18):
    draw.text(at, text, fill=PALETTE["muted"], font=font(size))


def section_header(draw, x, y, text):
    draw.rounded_rectangle((x, y, x + 310, y + 42), radius=12, fill="#DCE8FF")
    draw.text((x + 14, y + 8), text, fill=PALETTE["text"], font=font(23))


def new_canvas(title: str):
    img = Image.new("RGB", (W, H), PALETTE["bg"])
    draw = ImageDraw.Draw(img)
    draw.text((60, 28), title, fill=PALETTE["text"], font=font(46))
    draw.line((60, 92, W - 60, 92), fill="#C9D8F4", width=3)
    return img, draw


def make_dfd():
    img, draw = new_canvas("Snaplytics Data Flow Diagram (DFD)")
    section_header(draw, 80, 130, "External Entities")
    section_header(draw, 640, 130, "Core Processes")
    section_header(draw, 1320, 130, "Data Stores")

    card(draw, (100, 220, 430, 340), "Staff Admin\n(Electron)", "entity")
    card(draw, (100, 430, 430, 550), "Customer\n(HeigenKiosk)", "entity")
    card(draw, (100, 640, 430, 760), "Email Service", "entity")

    process_boxes = [
        (660, 200, 1130, 295, "Authentication"),
        (660, 330, 1130, 425, "Customer Management"),
        (660, 460, 1130, 555, "Booking Management"),
        (660, 590, 1130, 685, "Coupon Management"),
        (660, 720, 1130, 815, "Reporting / Action Logs"),
    ]
    for b in process_boxes:
        card(draw, b[:4], b[4], "panel")

    card(draw, (1360, 300, 1880, 450), "PostgreSQL\nPrimary Database", "store")
    card(draw, (1360, 520, 1880, 670), "Import / Staging\nData Store", "store")

    # Left to center
    arrow(draw, (430, 280), (660, 245))
    arrow(draw, (430, 490), (660, 505))
    arrow(draw, (430, 700), (660, 640))
    note(draw, (500, 255), "API requests")
    note(draw, (490, 515), "booking data")
    note(draw, (505, 650), "coupon send events")

    # Center to right
    for y in (245, 380, 505, 635, 770):
        arrow(draw, (1130, y), (1360, 365))
    arrow(draw, (1130, 635), (1360, 595))
    arrow(draw, (1130, 770), (1360, 595))
    note(draw, (1190, 330), "read / write core records")
    note(draw, (1200, 606), "bulk imports + temporary rows")

    # Coupon process to email service
    arrow(draw, (1130, 640), (430, 700))
    note(draw, (760, 666), "delivery payload to email provider")

    # Legend
    draw.rounded_rectangle((1420, 780, 1880, 1030), radius=14, fill="#F4F7FD", outline="#CFDAF2", width=2)
    draw.text((1450, 810), "Legend", fill=PALETTE["text"], font=font(26))
    card(draw, (1450, 850, 1600, 915), "Entity", "entity", size=20)
    card(draw, (1630, 850, 1780, 915), "Process", "panel", size=20)
    card(draw, (1450, 940, 1600, 1005), "Data Store", "store", size=18)
    arrow(draw, (1630, 972), (1780, 972))
    note(draw, (1640, 987), "Data Flow", size=16)

    img.save(ROOT / "dfd-snaplytics.png")


def make_erd():
    img, draw = new_canvas("Snaplytics Entity Relationship Diagram (ERD)")
    section_header(draw, 80, 130, "Business Domain")
    section_header(draw, 80, 640, "User / Admin Domain")

    def ebox(x1, y1, x2, y2, title, subtitle):
        card(draw, (x1, y1, x2, y2), title, "panel", size=24)
        note(draw, (x1 + 16, y2 - 32), subtitle, size=16)

    # Top band
    ebox(100, 220, 360, 330, "Customer", "PK customer_id")
    ebox(430, 220, 690, 330, "Booking", "FK customer, package, coupon")
    ebox(760, 220, 1020, 330, "Package", "PK id")
    ebox(1090, 220, 1350, 330, "Category", "PK id")
    ebox(1420, 220, 1880, 330, "Coupon", "PK id, code unique")

    # Middle band
    ebox(430, 410, 690, 520, "BookingAddon", "FK booking, addon")
    ebox(760, 410, 1020, 520, "Addon", "PK id")
    ebox(1090, 410, 1350, 520, "CouponUsage", "FK coupon, customer, booking")
    ebox(1420, 410, 1880, 520, "CouponSent", "FK coupon, customer")
    ebox(100, 410, 360, 520, "Renewal", "1:1 with customer")

    # Bottom band
    ebox(100, 730, 360, 840, "Django User", "AUTH_USER_MODEL")
    ebox(430, 730, 690, 840, "StaffProfile", "1:1 user profile")
    ebox(760, 730, 1020, 840, "EmailTemplate", "FK user")
    ebox(1090, 730, 1350, 840, "ActionLog", "FK actor_user")
    ebox(1420, 730, 1880, 840, "PasswordResetRequest", "FK user, reviewed_by")

    # Relations
    arrow(draw, (360, 275), (430, 275))
    note(draw, (372, 245), "1..*")
    arrow(draw, (760, 275), (690, 275))
    note(draw, (705, 298), "1..*")
    arrow(draw, (1020, 275), (1090, 275))
    note(draw, (1038, 245), "category tag")
    arrow(draw, (1420, 275), (690, 275))
    note(draw, (1030, 298), "0..* bookings")

    arrow(draw, (560, 330), (560, 410))
    note(draw, (574, 365), "1..*")
    arrow(draw, (760, 465), (690, 465))
    note(draw, (708, 438), "1..*")
    arrow(draw, (1220, 410), (560, 330))
    note(draw, (935, 392), "usage references booking")
    arrow(draw, (1420, 465), (360, 275))
    note(draw, (820, 472), "sent to customer")
    arrow(draw, (230, 410), (230, 330))
    note(draw, (246, 362), "1..1")

    arrow(draw, (360, 785), (430, 785))
    arrow(draw, (360, 785), (760, 785))
    arrow(draw, (360, 785), (1090, 785))
    arrow(draw, (360, 785), (1420, 785))
    note(draw, (790, 865), "user-linked admin entities")

    img.save(ROOT / "erd-snaplytics.png")


def make_architecture():
    img, draw = new_canvas("Snaplytics High-Level Architecture")
    section_header(draw, 80, 130, "Client Layer")
    section_header(draw, 700, 130, "Application Layer")
    section_header(draw, 1330, 130, "Data + Integrations")

    # Layers
    card(draw, (100, 230, 500, 350), "Electron Staff Admin", "panel")
    card(draw, (100, 420, 500, 540), "HeigenKiosk (Expo / RN)", "panel")
    card(draw, (100, 610, 500, 730), "Web / Internal Tools", "panel")

    card(
        draw,
        (700, 280, 1230, 730),
        "Django REST API\n\n- Auth + Roles\n- Coupon + Booking Logic\n- Customer Workflows\n- Reporting Endpoints",
        "panel",
    )

    card(draw, (1360, 240, 1880, 370), "PostgreSQL\nPrimary Persistence", "store")
    card(draw, (1360, 430, 1880, 560), "Email Provider", "entity")
    card(draw, (1360, 620, 1880, 750), "Media Storage", "entity")
    card(draw, (1360, 810, 1880, 940), "Analytics / Export Jobs", "entity")

    # Client -> API
    arrow(draw, (500, 290), (700, 390))
    arrow(draw, (500, 480), (700, 500))
    arrow(draw, (500, 670), (700, 620))
    note(draw, (535, 320), "HTTPS + token auth")
    note(draw, (540, 510), "CRUD + operational endpoints")

    # API -> integrations
    arrow(draw, (1230, 380), (1360, 305))
    arrow(draw, (1230, 470), (1360, 495))
    arrow(draw, (1230, 560), (1360, 685))
    arrow(draw, (1230, 650), (1360, 875))
    note(draw, (1240, 320), "ORM transactions")
    note(draw, (1240, 500), "notification dispatch")
    note(draw, (1240, 695), "files + reports")

    draw.rounded_rectangle((700, 780, 1230, 920), radius=14, fill="#EAF1FE", outline="#C9D8F4", width=2)
    note(draw, (730, 808), "Deployment Notes", size=24)
    note(draw, (730, 846), "- Local API default: localhost:8000", size=19)
    note(draw, (730, 876), "- Protected routes require staff token", size=19)

    img.save(ROOT / "architecture-snaplytics.png")


if __name__ == "__main__":
    make_dfd()
    make_erd()
    make_architecture()
    print("Generated dfd-snaplytics.png, erd-snaplytics.png, architecture-snaplytics.png")
