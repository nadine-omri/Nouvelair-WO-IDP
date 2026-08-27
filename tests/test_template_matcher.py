import numpy as np
from app.preprocessing.template_matcher import match_template

def test_template_matcher_no_template_neutral():
    img = np.full((500, 500), 255, dtype=np.uint8)
    res = match_template(img, None)
    assert res.matched is True
    assert res.score == 0.5