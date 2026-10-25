"""Configure server-side LLM access without credentials in argv or terminal output."""
import argparse,getpass
from photo_museum.auth import Security
from photo_museum.db import Database
from photo_museum.curator_provider import ProviderInput,save_config

def main():
 p=argparse.ArgumentParser();p.add_argument('--data',default='data/server');args=p.parse_args()
 db=Database(args.data);security=Security(db)
 key=getpass.getpass('API key (hidden): ')
 save_config(db,security,ProviderInput(api_key=key))
 print('Provider configured; key encrypted locally.')
if __name__=='__main__':main()
