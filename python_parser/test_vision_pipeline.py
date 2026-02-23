"""
Tests for Vision Pipeline endpoints in api_server.py
"""
import pytest
import io
import base64
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


class TestVisionRenderPDF:
    """Tests for /vision/render-pdf endpoint"""

    def test_render_pdf_empty_file(self):
        """Should reject empty file upload"""
        from api_server import app
        client = TestClient(app)

        response = client.post(
            "/vision/render-pdf",
            files={"file": ("test.pdf", b"", "application/pdf")},
        )
        assert response.status_code == 400
        assert "Empty file" in response.json()["detail"]

    @patch("api_server._get_pdf2image")
    def test_render_pdf_success(self, mock_get_pdf2image):
        """Should render PDF pages to base64 images"""
        from api_server import app
        client = TestClient(app)

        # Create mock images
        from PIL import Image
        mock_img = Image.new("RGB", (100, 100), "white")

        mock_pdf2image = MagicMock()
        mock_pdf2image.convert_from_path.return_value = [mock_img, mock_img]
        mock_get_pdf2image.return_value = mock_pdf2image

        response = client.post(
            "/vision/render-pdf?dpi=150",
            files={"file": ("test.pdf", b"fake-pdf-bytes", "application/pdf")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["page_count"] == 2
        assert data["rendered_count"] == 2
        assert data["truncated"] is False
        assert len(data["images"]) == 2

        # Verify images are valid base64
        for img_b64 in data["images"]:
            decoded = base64.b64decode(img_b64)
            assert len(decoded) > 0

    @patch("api_server._get_pdf2image")
    def test_render_pdf_custom_dpi(self, mock_get_pdf2image):
        """Should pass DPI parameter to pdf2image"""
        from api_server import app
        client = TestClient(app)

        from PIL import Image
        mock_img = Image.new("RGB", (100, 100), "white")

        mock_pdf2image = MagicMock()
        mock_pdf2image.convert_from_path.return_value = [mock_img]
        mock_get_pdf2image.return_value = mock_pdf2image

        response = client.post(
            "/vision/render-pdf?dpi=300",
            files={"file": ("test.pdf", b"fake-pdf", "application/pdf")},
        )

        assert response.status_code == 200
        mock_pdf2image.convert_from_path.assert_called_once()
        call_args = mock_pdf2image.convert_from_path.call_args
        assert call_args[1]["dpi"] == 300 or call_args[0][1] == 300 or call_args.kwargs.get("dpi") == 300


class TestVisionRenderPPTX:
    """Tests for /vision/render-pptx endpoint"""

    def test_render_pptx_empty_file(self):
        """Should reject empty file upload"""
        from api_server import app
        client = TestClient(app)

        response = client.post(
            "/vision/render-pptx",
            files={"file": ("test.pptx", b"", "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
        )
        assert response.status_code == 400
        assert "Empty file" in response.json()["detail"]

    @patch("api_server._get_pil")
    @patch("api_server._get_pptx")
    def test_render_pptx_success(self, mock_get_pptx, mock_get_pil):
        """Should render PPTX slides to base64 images"""
        from api_server import app
        from PIL import Image
        client = TestClient(app)

        # Mock Presentation
        mock_slide = MagicMock()
        mock_slide.shapes = []
        mock_prs = MagicMock()
        mock_prs.slides = [mock_slide, mock_slide]
        mock_prs.slide_width = 9144000  # 10 inches in EMU
        mock_prs.slide_height = 6858000  # 7.5 inches in EMU

        MockPresentation = MagicMock(return_value=mock_prs)
        mock_get_pptx.return_value = MockPresentation
        mock_get_pil.return_value = Image

        # Create a minimal valid PPTX-like bytes (the mock handles parsing)
        response = client.post(
            "/vision/render-pptx?dpi=150",
            files={"file": ("deck.pptx", b"fake-pptx-bytes", "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["page_count"] == 2
        assert data["rendered_count"] == 2
        assert data["truncated"] is False
        assert len(data["images"]) == 2

    @patch("api_server._get_pil")
    @patch("api_server._get_pptx")
    def test_render_pptx_truncation(self, mock_get_pptx, mock_get_pil):
        """Should truncate at 100 slides and warn"""
        from api_server import app
        from PIL import Image
        client = TestClient(app)

        # Create 120 mock slides
        mock_slides = [MagicMock(shapes=[]) for _ in range(120)]
        mock_prs = MagicMock()
        mock_prs.slides = mock_slides
        mock_prs.slide_width = 9144000
        mock_prs.slide_height = 6858000

        MockPresentation = MagicMock(return_value=mock_prs)
        mock_get_pptx.return_value = MockPresentation
        mock_get_pil.return_value = Image

        response = client.post(
            "/vision/render-pptx?dpi=150",
            files={"file": ("big.pptx", b"fake-pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["page_count"] == 120
        assert data["rendered_count"] == 100
        assert data["truncated"] is True
        assert len(data["images"]) == 100
        assert any("120 slides" in w for w in data["warnings"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
