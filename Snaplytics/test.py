# test_spark_env.py
import os,sys,traceback,subprocess,shutil
os.environ["JAVA_HOME"] = r"C:\Program Files\Java\jdk-17"
os.environ["PATH"] = os.path.join(os.environ["JAVA_HOME"], "bin") + os.pathsep + os.environ.get("PATH","")
# force binding to localhost to avoid network binding issues
os.environ["SPARK_LOCAL_IP"] = "127.0.0.1"
os.environ["SPARK_DRIVER_HOST"] = "127.0.0.1"

print("python:", sys.executable)
print("JAVA_HOME:", os.environ.get("JAVA_HOME"))
print("shutil.which(java):", shutil.which("java"))
try:
    # print java details
    print("java -XshowSettings:properties -version (first lines):")
    subprocess.run(["java","-XshowSettings:properties","-version"], check=False)
except Exception as e:
    print("Failed to run java subprocess:", e)

try:
    from pyspark.sql import SparkSession
    spark = (SparkSession.builder
             .appName("test")
             .master("local[*]")
             .config("spark.ui.showConsoleProgress", "false")
             .config("spark.driver.bindAddress","127.0.0.1")
             .getOrCreate())
    print("Spark started OK, version:", spark.version)
    spark.stop()
except Exception:
    print("ERROR starting Spark:")
    traceback.print_exc()
