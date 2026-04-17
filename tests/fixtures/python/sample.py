"""Sample Python fixture with various branching constructs."""


class UserService:
    def __init__(self, name):
        self.name = name

    def classify(self, x):
        if x > 0:
            return 'positive'
        elif x < 0:
            return 'negative'
        return 'zero'

    def process(self, items):
        results = []
        for item in items:
            if item is None:
                continue
            try:
                results.append(item.upper())
            except AttributeError:
                results.append(str(item))
        return results


def helper(value):
    return value * 2 if value else 0
