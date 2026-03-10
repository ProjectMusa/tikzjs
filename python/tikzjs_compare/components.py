"""
Connected-component extraction and structural diff computation.
"""

from typing import TypedDict

import numpy as np
import cv2

from .config import DILATION_RADIUS


class ComponentStats(TypedDict):
    n_components: int
    areas: list[int]           # sorted descending
    bboxes: list[tuple]        # (x, y, w, h)
    binary: np.ndarray         # thresholded mask
    total_fg_pixels: int


def extract_components(img: np.ndarray, threshold: int = 240) -> ComponentStats:
    """
    Extract connected foreground components from a BGR image.

    Pixels darker than `threshold` are treated as foreground (ink).
    A small morphological close is applied first to merge anti-aliased gaps.

    Returns a dict with component count, sorted areas, bounding boxes,
    the binary mask, and the total foreground pixel count.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)

    # Merge nearby pixels to handle anti-aliasing fragmentation
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    n_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    # Label 0 is background — skip it
    areas = sorted(
        [stats[i, cv2.CC_STAT_AREA] for i in range(1, n_labels)],
        reverse=True
    )
    bboxes = [
        (stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP],
         stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
        for i in range(1, n_labels)
    ]

    return ComponentStats(
        n_components=n_labels - 1,
        areas=areas,
        bboxes=bboxes,
        binary=binary,
        total_fg_pixels=int(np.sum(binary > 0)),
    )


def content_bbox(binary: np.ndarray) -> tuple[int, int, int, int]:
    """Return (x, y, w, h) tight bounding box of non-zero pixels."""
    coords = cv2.findNonZero(binary)
    if coords is None:
        return 0, 0, binary.shape[1], binary.shape[0]
    return cv2.boundingRect(coords)


def crop_to_content(binary: np.ndarray, padding: int = 6) -> np.ndarray:
    """
    Crop a binary image to the bounding box of its content, with a small padding.
    This removes whitespace/margin differences between our SVG and the reference.
    """
    x, y, w, h = content_bbox(binary)
    H, W = binary.shape[:2]
    x1, y1 = max(0, x - padding), max(0, y - padding)
    x2, y2 = min(W, x + w + padding), min(H, y + h + padding)
    return binary[y1:y2, x1:x2]


def structural_diff_pct(
    img_a: np.ndarray,
    img_b: np.ndarray,
    threshold: int = 240,
    dilation: int = DILATION_RADIUS,
) -> float:
    """
    Compute structural pixel diff between two BGR images.

    Algorithm:
    1. Convert to binary masks (dark = foreground)
    2. Crop both to their content bounding boxes (removes whitespace differences
       that arise from different SVG canvas margins)
    3. Resize image_a's crop to match image_b's crop dimensions
    4. Dilate both masks by `dilation` pixels (absorbs 1–3px positional shifts
       from anti-aliasing and rounding differences)
    5. XOR the two dilated masks and report the fraction of differing pixels

    Returns a percentage in [0, 100].
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
        return 0.0 if crop_a.size == crop_b.size else 100.0

    h, w = crop_b.shape[:2]
    crop_a = cv2.resize(crop_a, (w, h), interpolation=cv2.INTER_AREA)
    _, crop_a = cv2.threshold(crop_a, 127, 255, cv2.THRESH_BINARY)

    if dilation > 0:
        k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1)
        )
        crop_a = cv2.dilate(crop_a, k)
        crop_b = cv2.dilate(crop_b, k)

    xor = cv2.bitwise_xor(crop_a, crop_b)
    return 100.0 * int(np.sum(xor > 0)) / (w * h) if (w * h) > 0 else 0.0


def raw_pixel_diff_pct(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """
    Naive pixel diff: resize img_a to img_b's dimensions and compare.
    Used for informational display only — sensitive to margin/scale differences.
    """
    h, w = img_b.shape[:2]
    a = cv2.resize(img_a, (w, h), interpolation=cv2.INTER_AREA)
    diff = cv2.absdiff(a, img_b)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray_diff, 10, 255, cv2.THRESH_BINARY)
    return 100.0 * int(np.sum(mask > 0)) / (w * h) if (w * h) > 0 else 0.0
