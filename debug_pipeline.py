"""
Script de debug incremental : execute le pipeline etape par etape sur UN
scan reel, sauvegarde une image a chaque etape dans debug_out/, et affiche
un rapport clair de ce qui marche / ce qui casse a quel niveau.

Usage :
    python debug_pipeline.py chemin/vers/ton_scan.png

Objectif : au lieu de lancer tout le pipeline d'un coup et de recevoir un
JSON degrade sans savoir pourquoi, on isole chaque etape. Commente/decommente
les blocs STEP_x pour avancer petit a petit.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.preprocessing.image_preprocessor import preprocess
from app.preprocessing.document_detector import detect_document
from app.preprocessing.template_alignment import align_to_template
from app.preprocessing.template_matcher import match_template
from configs.config import TEMPLATES_DIR, PREPROCESS, VISION

OUT = Path("debug_out")
OUT.mkdir(exist_ok=True)


def report(title):
    print(f"\n{'='*60}\n{title}\n{'='*60}")


def save(name, img):
    path = OUT / name
    cv2.imwrite(str(path), img)
    print(f"  -> sauvegarde: {path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python debug_pipeline.py chemin/vers/scan.png")
        sys.exit(1)

    scan_path = Path(sys.argv[1])
    img = cv2.imread(str(scan_path))
    if img is None:
        print(f"ERREUR: impossible de lire l'image {scan_path}")
        sys.exit(1)

    h, w = img.shape[:2]
    report("STEP 0 - Image source")
    print(f"  Fichier      : {scan_path}")
    print(f"  Resolution   : {w}x{h} px")
    print(f"  Poids        : {scan_path.stat().st_size / 1024:.0f} Ko")

    # --- Comparaison avec le template de reference utilise pour le calibrage ---
    ref_path = TEMPLATES_DIR / "reference_form.png"
    if ref_path.exists():
        ref = cv2.imread(str(ref_path))
        rh, rw = ref.shape[:2]
        ratio = w / rw
        print(f"\n  Reference (reference_form.png) : {rw}x{rh} px")
        print(f"  Ratio largeur scan / reference  : {ratio:.2f}x")
        if ratio < 0.5:
            print("  ⚠️  ATTENTION : ton scan fait moins de la moitie de la resolution du")
            print("      template de reference. Le pipeline va l'agrandir artificiellement")
            print("      (interpolation), ce qui NE RECREE PAS de detail reel -- le texte")
            print("      manuscrit fin restera flou/blocky apres upscale. C'est une cause")
            print("      tres probable de mauvaise OCR, independamment du calibrage ROI ou")
            print("      du modele utilise.")
            print("      -> Utilise un scan/export a la resolution native la plus haute")
            print("         possible (300 DPI ideal), pas une capture d'ecran d'apercu.")

    report("STEP 1 - Preprocessing (resize -> gray -> denoise -> contrast -> deskew)")
    try:
        pre = preprocess(img)
        for step_name, step_img in pre.steps.items():
            save(f"1_{step_name}.png", step_img)
        save("1_final_gray.png", pre.gray)
        save("1_final_binary.png", pre.binary)
        print(f"  Angle de redressement : {pre.deskew_angle:.2f} degres")
        print(f"  Taille apres resize    : {pre.gray.shape[1]}x{pre.gray.shape[0]}")
        print("  OK -- inspecte les fichiers 1_*.png dans debug_out/, en particulier")
        print("  1_denoised.png et 1_contrast_enhanced.png : le texte doit rester net,")
        print("  pas flou/pate. Si c'est deja flou ici, le probleme vient de la SOURCE")
        print("  (resolution du scan), pas du code de preprocessing.")
    except Exception as e:
        print(f"  ❌ ECHEC au preprocessing: {e}")
        import traceback; traceback.print_exc()
        sys.exit(1)

    report("STEP 2 - Detection du document (bords / cadrage)")
    try:
        detector = detect_document(img)
        print(f"  Detecte    : {detector.detected}")
        print(f"  Confiance  : {detector.confidence:.2f}")
        save("2_detected.png", detector.image)
        if not detector.detected:
            print("  ⚠️  Document non detecte correctement -- le recadrage automatique")
            print("      des bords peut couper une partie du formulaire.")
    except Exception as e:
        print(f"  ❌ ECHEC a la detection: {e}")
        import traceback; traceback.print_exc()

    report("STEP 3 - Alignement sur le template de reference (ORB)")
    try:
        if ref_path.exists():
            ref_gray = cv2.imread(str(ref_path), cv2.IMREAD_GRAYSCALE)
            aligned = align_to_template(pre.gray, ref_gray)
            if aligned is not None:
                save("3_aligned.png", aligned)
                match = match_template(aligned, ref_gray)
                print(f"  Alignement reussi. Score de correspondance template: {match.score:.3f}")
                if match.score < 0.5:
                    print("  ⚠️  Score de correspondance bas : l'alignement a probablement mal")
                    print("      fonctionne (pas assez de points-cles ORB detectes -- souvent")
                    print("      du a une image trop petite/floue, voir STEP 0).")
            else:
                print("  ❌ align_to_template a renvoye None -- alignement echoue")
                print("      (pas assez de correspondances ORB trouvees entre le scan et")
                print("      reference_form.png). C'est probablement le vrai point de")
                print("      casse si les zones ROI tombent n'importe ou ensuite.")
        else:
            print("  (reference_form.png introuvable, alignement saute)")
    except Exception as e:
        print(f"  ❌ ECHEC a l'alignement: {e}")
        import traceback; traceback.print_exc()

    report("STEP 4 - OCR Tesseract sur les champs 'printed' uniquement (rapide, sans TrOCR)")
    try:
        from app.ocr.ocr_engine import TesseractEngine, ocr_zone
        import json
        tpl = json.load(open("configs/roi_template.json"))
        work_img = aligned if 'aligned' in dir() and aligned is not None else pre.gray
        wh, ww = work_img.shape[:2]
        tess = TesseractEngine()
        for zone in tpl["zones"]:
            if zone["type"] != "printed":
                continue
            x0, y0, x1, y1 = zone["bbox"]
            bbox_px = (int(x0*ww), int(y0*wh), int((x1-x0)*ww), int((y1-y0)*wh))
            o = ocr_zone(work_img, bbox_px, engine=tess, multiline=zone.get("multiline", False))
            print(f"  [{zone['field']}] -> '{o.text.strip()}' (conf={o.mean_confidence:.1f})")
    except Exception as e:
        print(f"  ❌ ECHEC OCR Tesseract: {e}")
        import traceback; traceback.print_exc()

    report("STEP 5 - Extraction complete (TrOCR manuscrit + Tesseract imprime + tableau)")
    print("  Chargement du modele TrOCR (peut prendre 30s-2min au premier lancement,")
    print("  telecharge ~1.5 Go depuis Hugging Face la premiere fois)...")
    try:
        from app.extraction.information_extractor import InformationExtractor
        work_img = aligned if 'aligned' in dir() and aligned is not None else pre.gray
        extractor = InformationExtractor()
        result = extractor.extract(work_img)

        print("\n  --- Champs scalaires ---")
        for name, fv in result.fields.items():
            flag = "⚠️ " if fv.needs_review else "✅ "
            print(f"  {flag}{name:22s} = {str(fv.value)[:60]!r:65s} (conf={fv.confidence:.0f})")

        print("\n  --- Tableau material_sold ---")
        if result.material_sold:
            for i, row in enumerate(result.material_sold):
                print(f"  ligne {i}: qty={row.qty!r} designation={row.designation!r} "
                      f"reference={row.reference!r} price={row.price!r} (raw={row.price_raw!r})")
        else:
            print("  (aucune ligne detectee -- soit le tableau est vide sur ce scan, soit")
            print("   has_ink() ne detecte pas d'encre, a verifier si tu sais qu'il y a")
            print("   des lignes remplies)")
    except Exception as e:
        print(f"  ❌ ECHEC extraction complete: {e}")
        import traceback; traceback.print_exc()

    report("STEP 6 - Extraction vision Gemini (si GEMINI_API_KEY configuree)")
    import os
    from configs.config import VISION
    if not os.environ.get(VISION.api_key_env):
        print(f"  (variable '{VISION.api_key_env}' absente -- etape sautee. Configure ton")
        print("   .env pour tester cette etape.)")
    else:
        try:
            from app.extraction.gemini_vision_extractor import GeminiVisionExtractor
            gextractor = GeminiVisionExtractor()
            gresult = gextractor.extract(detector.image)

            print("\n  --- Champs scalaires (Gemini) ---")
            for name, fv in gresult.fields.items():
                flag = "⚠️ " if fv.needs_review else "✅ "
                print(f"  {flag}{name:22s} = {str(fv.value)[:70]!r:75s} (conf={fv.confidence:.0f})")

            print("\n  --- Tableau material_sold (Gemini) ---")
            if gresult.material_sold:
                for i, row in enumerate(gresult.material_sold):
                    print(f"  ligne {i}: qty={row.qty!r} designation={row.designation!r} "
                          f"reference={row.reference!r} price={row.price!r} (raw={row.price_raw!r})")
            else:
                print("  (aucune ligne detectee)")
        except Exception as e:
            print(f"  ❌ ECHEC extraction Gemini: {e}")
            import traceback; traceback.print_exc()

    report("STEP 7 - Extraction vision Ollama (locale, si Ollama tourne)")
    try:
        from app.extraction.ollama_vision_extractor import OllamaVisionExtractor
        oextractor = OllamaVisionExtractor()
        print(f"  Modele : {oextractor.model} sur {oextractor.host} -- peut prendre")
        print("  30s a plusieurs minutes sur CPU selon le modele...")
        oresult = oextractor.extract(detector.image)

        print("\n  --- Champs scalaires (Ollama) ---")
        for name, fv in oresult.fields.items():
            flag = "⚠️ " if fv.needs_review else "✅ "
            print(f"  {flag}{name:22s} = {str(fv.value)[:70]!r:75s} (conf={fv.confidence:.0f})")

        print("\n  --- Tableau material_sold (Ollama) ---")
        if oresult.material_sold:
            for i, row in enumerate(oresult.material_sold):
                print(f"  ligne {i}: qty={row.qty!r} designation={row.designation!r} "
                      f"reference={row.reference!r} price={row.price!r} (raw={row.price_raw!r})")
        else:
            print("  (aucune ligne detectee)")
    except Exception as e:
        print(f"  ❌ ECHEC extraction Ollama: {e}")
        import traceback; traceback.print_exc()

    report("STEP 8 - Validation de contenu (le vrai garde-fou) sur le resultat du STEP 5")
    print("  Contrairement a la confiance OCR (qui mesure la fluidite du texte genere,")
    print("  pas sa fidelite a l'image), cette etape verifie si le CONTENU a un sens")
    print("  dans le contexte d'un ordre de travail aviation.")
    try:
        from app.extraction.llm_validator import validate_with_llm
        if 'result' in dir():
            llm_report = validate_with_llm(result)
            if not llm_report.used_llm:
                print("  (validation non executee -- GEMINI_API_KEY absente ou appel echoue,")
                print("   voir warning au-dessus dans les logs)")
            else:
                print(f"  Score de confiance CONTENU (pas OCR) : {llm_report.confidence_score:.2f}")
                if llm_report.issues:
                    print("  Incoherences detectees :")
                    for issue in llm_report.issues:
                        print(f"    ⚠️  {issue}")
                else:
                    print("  Aucune incoherence de contenu detectee.")
        else:
            print("  (STEP 5 n'a pas produit de resultat, rien a valider)")
    except Exception as e:
        print(f"  ❌ ECHEC validation: {e}")
        import traceback; traceback.print_exc()

    report("STEP 9 - Pipeline complet avec chaine de fallback (comme en production)")
    print(f"  Chaine configuree : {VISION.provider} -> {' -> '.join(VISION.fallback_chain)} -> local")
    try:
        from app.main import process_document
        full_result = process_document(img, use_vision_llm=True)
        print(f"  Moteur reellement utilise : {full_result.engine_used}")
        print(f"  A verifier              : {full_result.requires_review}")
        for reason in full_result.review_reasons:
            print(f"    - {reason}")
        print(f"  Confiance globale        : {full_result.global_confidence_score:.0%}")
        print(f"  Temps total              : {full_result.processing_time_s:.1f}s")
    except Exception as e:
        print(f"  ❌ ECHEC pipeline complet: {e}")
        import traceback; traceback.print_exc()

    report("RESUME")
    print("  Etapes 0-5 executees. Regarde les images dans debug_out/ dans l'ordre")
    print("  (1_resized -> 1_grayscale -> 1_denoised -> 1_contrast_enhanced -> ")
    print("  1_deskewed -> 2_detected -> 3_aligned) pour voir a quelle etape le")
    print("  texte devient illisible ou mal cadre.")
    print()
    print("  L'extraction vision Gemini n'est PAS testee ici : lance-la depuis")
    print("  streamlit_app.py (case a cocher) une fois GEMINI_API_KEY configuree.")
