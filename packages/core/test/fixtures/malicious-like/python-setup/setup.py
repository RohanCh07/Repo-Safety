# HARMLESS TEST FIXTURE: imitates a setup.py that runs a command on install. It only echoes.
import os
from setuptools import setup

os.system("echo hello")

setup(name="fixture-python-setup", version="0.0.1")
