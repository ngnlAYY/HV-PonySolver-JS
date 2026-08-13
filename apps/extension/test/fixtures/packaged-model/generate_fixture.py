from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


ROOT = Path(__file__).resolve().parent
ONNX_PATH = ROOT / "deterministic-captcha.onnx"


def build_model() -> onnx.ModelProto:
    images = helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, 640, 640])
    output = helper.make_tensor_value_info("output0", TensorProto.FLOAT, [1, 6])
    detection = numpy_helper.from_array(
        np.asarray([[0.0, 0.0, 1.0, 1.0, 0.95, 0.0]], dtype=np.float32),
        name="deterministic_detection",
    )
    constant = helper.make_node("Constant", inputs=[], outputs=["output0"], value=detection)
    graph = helper.make_graph([constant], "hv_pony_solver_packaged_fixture", [images], [output])
    model = helper.make_model(
        graph,
        producer_name="hv-pony-solver",
        producer_version="1",
        opset_imports=[helper.make_opsetid("", 21)],
    )
    model.ir_version = 10
    onnx.checker.check_model(model)
    return model


onnx.save_model(build_model(), ONNX_PATH, save_as_external_data=False)
