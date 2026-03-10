"""
Connected-component extraction, structural diff, and visualization helpers.
"""

from typing import TypedDict

import numpy as np
import cv2

from .config import DILATION_RADIUS

# Visually distinct BGR colors for component overlays (up to 16 components)
_PALETTE = [
    (220,  50,  50),  # red
    ( 50, 130, 220),  # blue
    ( 50, 180,  50),  # green
    (200, 140,  20),  # orange
    (150,  50, 200),  # purple
    ( 20, 180, 180),  # teal
    (220,  80, 160),  # pink
    (100, 160,  40),  # olive
    ( 60,  60, 220),  # navy
    (180, 220,  40),  # lime
    (200,  40, 120),  # crimson
    ( 40, 200, 140),  # mint
    (220, 160,  40),  # amber
    (100,  40, 180),  # violet
    ( 40, 140, 220),  # sky
    (160,  80,  40),  # brown
]


class ComponentStats(TypedDict):
    n_components: int
    areas: list[int]       # sorted descending
    bboxes: list[tuple]    # (x, y, w, h), same order as areas
    labels_map: np.ndarray # label image from connectedComponents
    label_ids: list[int]   # label ids sorted by descending area
    binary: np.ndarray
    total_fg_pixels: int


def extract_components(img: np.ndarray, threshold: int = 240) -> ComponentStats:
    """
    Extract connected foreground components from a BGR image.
    Returns component stats including a label map for visualization.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    n_labels, labels_map, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    # Sort by area descending, skip background (label 0)
    label_ids = sorted(range(1, n_labels), key=lambda i: stats[i, cv2.CC_STAT_AREA], reverse=True)
    areas  = [stats[i, cv2.CC_STAT_AREA] for i in label_ids]
    bboxes = [(stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP],
               stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
              for i in label_ids]

    return ComponentStats(
        n_components=n_labels - 1,
        areas=areas,
        bboxes=bboxes,
        labels_map=labels_map,
        label_ids=label_ids,
        binary=binary,
        total_fg_pixels=int(np.sum(binary > 0)),
    )


def render_component_overlay(img: np.ndarray, cc: ComponentStats) -> np.ndarray:
    """
    Return a BGR image with each connected component filled in a distinct color
    (50 % alpha blend over the original), bounding box, and rank label.
    """
    out = img.copy()
    overlay = img.copy()

    for rank, (lid, bbox) in enumerate(zip(cc['label_ids'], cc['bboxes'])):
        color = _PALETTE[rank % len(_PALETTE)]
        mask = (cc['labels_map'] == lid).astype(np.uint8) * 255
        overlay[mask > 0] = color

        x, y, w, h = bbox
        cv2.rectangle(overlay, (x, y), (x + w, y + h), color, 1)

        label = str(rank + 1)
        font_scale = max(0.3, min(0.5, w / 60))
        cv2.putText(overlay, label, (x + 2, y + max(10, h // 2)),
                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), 1, cv2.LINE_AA)

    cv2.addWeighted(overlay, 0.55, out, 0.45, 0, out)
    return out


def content_bbox(binary: np.ndarray) -> tuple[int, int, int, int]:
    """Return (x, y, w, h) tight bounding box of non-zero pixels."""
    coords = cv2.findNonZero(binary)
    if coords is None:
        return 0, 0, binary.shape[1], binary.shape[0]
    return cv2.boundingRect(coords)


def crop_to_content(binary: np.ndarray, padding: int = 6) -> np.ndarray:
    """Crop a binary image to its content bounding box plus padding."""
    x, y, w, h = content_bbox(binary)
    H, W = binary.shape[:2]
    x1, y1 = max(0, x - padding), max(0, y - padding)
    x2, y2 = min(W, x + w + padding), min(H, y + h + padding)
    return binary[y1:y2, x1:x2]


def structural_diff(
    img_a: np.ndarray,
    img_b: np.ndarray,
    threshold: int = 240,
    dilation: int = DILATION_RADIUS,
) -> tuple[float, np.ndarray]:
    """
    Compute structural diff and return (pct, diff_image).

    diff_image is a color BGR image (same size as img_b content crop) where:
      - Red   = pixels present in ours but not in ref
      - Blue  = pixels present in ref but not in ours
      - Gray  = pixels present in both (agreement)
      - White = background
    """
    def to_binary(img: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)
        return binary

    bin_a = to_binary(img_a)
    bin_b = to_binary(img_b)

    crop_a = crop_to_content(bin_a)
    crop_b = crop_to_content(bin_b)

    if crop_a.size == 0 or crop_b.size == 0:
        pct = 0.0 if crop_a.size == crop_b.size else 100.0
        h, w = crop_b.shape[:2] if crop_b.size else (1, 1)
        return pct, np.full((h, w, 3), 255, dtype=np.uint8)

    h, w = crop_b.shape[:2]
    crop_a = cv2.resize(crop_a, (w, h), interpolation=cv2.INTER_AREA)
    _, crop_a = cv2.threshold(crop_a, 127, 255, cv2.THRESH_BINARY)

    dilated_a, dilated_b = crop_a.copy(), crop_b.copy()
    if dilation > 0:
        k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1)
        )
        dilated_a = cv2.dilate(crop_a, k)
        dilated_b = cv2.dilate(crop_b, k)

    xor = cv2.bitwise_xor(dilated_a, dilated_b)
    pct = 100.0 * int(np.sum(xor > 0)) / (w * h) if (w * h) > 0 else 0.0

    # Build colored diff image
    vis = np.full((h, w, 3), 255, dtype=np.uint8)  # white background
    both  = cv2.bitwise_and(dilated_a, dilated_b)
    only_a = cv2.bitwise_and(dilated_a, cv2.bitwise_not(dilated_b))
    only_b = cv2.bitwise_and(dilated_b, cv2.bitwise_not(dilated_a))

    vis[both   > 0] = (210, 210, 210)  # gray  — agreement
    vis[only_a > 0] = ( 60,  60, 220)  # red   — extra in ours
    vis[only_b > 0] = (220,  60,  60)  # blue  — missing from ours

    return pct, vis


def structural_diff_pct(
    img_a: np.ndarray,
    img_b: np.ndarray,
    threshold: int = 240,
    dilation: int = DILATION_RADIUS,
) -> float:
    """Structural diff percentage (see structural_diff for full details)."""
    pct, _ = structural_diff(img_a, img_b, threshold, dilation)
    return pct


def raw_pixel_diff_pct(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Naive resize-then-diff percentage. Sensitive to margin differences."""
    h, w = img_b.shape[:2]
    a = cv2.resize(img_a, (w, h), interpolation=cv2.INTER_AREA)
    diff = cv2.absdiff(a, img_b)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray_diff, 10, 255, cv2.THRESH_BINARY)
    return 100.0 * int(np.sum(mask > 0)) / (w * h) if (w * h) > 0 else 0.0
