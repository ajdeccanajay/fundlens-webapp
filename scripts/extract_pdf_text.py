#!/usr/bin/env python3
"""Extract text from a PDF file using PyPDF2. Prints to stdout."""
import sys
from PyPDF2 import PdfReader

reader = PdfReader(sys.argv[1])
for page in reader.pages:
    text = page.extract_text()
    if text:
        print(text)
