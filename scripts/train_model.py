import numpy as np
import os
from sklearn.ensemble import RandomForestRegressor
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

def main():
    print("Generating dummy DeFi credit data...")
    # Features: [paymentHistoryRatio, creditUtilisation, incomeStability, debtToIncomeRatio]
    # We will generate 1000 random samples.
    # Payment History (0.0 to 1.0)
    # Credit Util (0.0 to 1.0)
    # Income Stability (0.0 to 1.0)
    # Debt To Income (0.0 to 1.0)
    
    np.random.seed(42)
    X = np.random.rand(1000, 4)
    
    # Target: Default Probability (0.0 to 1.0)
    # Higher payment history -> lower default
    # Higher credit util -> higher default
    # Higher stability -> lower default
    # Higher DTI -> higher default
    y = 0.5 - 0.4 * X[:, 0] + 0.3 * X[:, 1] - 0.2 * X[:, 2] + 0.4 * X[:, 3]
    y = np.clip(y + np.random.normal(0, 0.05, 1000), 0.0, 1.0)

    print("Training RandomForestRegressor...")
    model = RandomForestRegressor(n_estimators=10, max_depth=5, random_state=42)
    model.fit(X, y)
    
    print("Exporting model to ONNX...")
    initial_type = [('float_input', FloatTensorType([None, 4]))]
    onx = convert_sklearn(model, initial_types=initial_type)
    
    # Always resolve relative to this script file so the output is
    # iapp/model/credit_model.onnx regardless of the working directory.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir  = os.path.join(script_dir, "..", "iapp", "model")
    os.makedirs(model_dir, exist_ok=True)
    onnx_path  = os.path.join(model_dir, "credit_model.onnx")
    
    with open(onnx_path, "wb") as f:
        f.write(onx.SerializeToString())
        
    print(f"Model successfully saved to {os.path.abspath(onnx_path)}")

if __name__ == "__main__":
    main()
