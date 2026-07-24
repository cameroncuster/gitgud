import unittest
from types import SimpleNamespace

from classify_problems import GEMINI_MODEL, classify_problem


class FakeModels:
    def __init__(self, response_text=None, error=None):
        self.response_text = response_text
        self.error = error
        self.calls = []

    def generate_content(self, *, model, contents):
        self.calls.append({"model": model, "contents": contents})
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.response_text)


class FakeClient:
    def __init__(self, response_text=None, error=None):
        self.models = FakeModels(response_text=response_text, error=error)


class ClassifyProblemTest(unittest.TestCase):
    def test_uses_supported_genai_client_and_normalizes_response(self):
        client = FakeClient(response_text=" Graph \n")

        result = classify_problem(
            "Shortest Path", ["graphs"], "Find the shortest route.", client=client
        )

        self.assertEqual(result, "graph")
        self.assertEqual(client.models.calls[0]["model"], GEMINI_MODEL)
        self.assertIn("Problem name: Shortest Path", client.models.calls[0]["contents"])

    def test_invalid_response_falls_back_to_misc(self):
        client = FakeClient(response_text="dynamic programming")

        self.assertEqual(classify_problem("Example", [], client=client), "misc")

    def test_sdk_error_falls_back_to_misc(self):
        client = FakeClient(error=RuntimeError("offline"))

        self.assertEqual(classify_problem("Example", [], client=client), "misc")


if __name__ == "__main__":
    unittest.main()
