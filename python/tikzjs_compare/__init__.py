"""
tikzjs_compare — golden SVG comparison using OpenCV connected-component analysis.

Public API:
    compare_fixture(name)        → CompareResult
    write_html_report(results)   → Path
    CompareResult                dataclass

Configuration is read from environment variables (see config.py).
"""

from .compare import compare_fixture, CompareResult
from .report import write_html_report

__all__ = ['compare_fixture', 'CompareResult', 'write_html_report']
