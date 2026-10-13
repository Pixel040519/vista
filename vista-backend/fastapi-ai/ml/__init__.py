"""
Trained models for the VISTA AI service.

    synthetic.py    the fake school the models are trained on
    features.py     the one list of inputs training and the live endpoints share
    naive_bayes.py  Gaussian Naive Bayes that skips missing inputs
    risk_model.py   risk tier: the trained model, or the old rules as backup
    grade_model.py  next-period grade: the trained regression, or the old curve

Train with `scripts/generate_synthetic.py` then `scripts/train_models.py`.
"""
